# Delete + insert flow for slide objects

## Status

Followup spec from the embed-polish work in commit `<TBD>`. Not yet
implemented. Filed because the user typed Backspace on a `<BlueSky>` embed and
expected it to disappear, and noticed there's no other way to add a new
embed/image to a slide besides hand-editing markdown.

## Motivation

The fork already feels close to a no-markdown direct-manipulation editing
experience for *position* (drag/resize/rotate/crop) and *order* (z-index
shortcuts). But two basic editor operations still require leaving the slide:

1. **Delete** — removing an object requires opening the source `.md`, finding
   the right tag/image line, deleting it, then cleaning up the dragPos entry
   in `slides.coords.yaml` (otherwise the orphan key lingers forever).
2. **Insert** — adding an image works through the file-drop / `i` picker
   (`specs/done/insert-image-picker.md`), but there's no comparable affordance
   for embeds. Adding a Tweet/YouTube/BlueSky still means typing the tag by
   hand in the markdown file.

## Scope (Stage 1: delete only)

A single keystroke removes the currently-selected object from the slide.

- **Key**: `Delete` or `Backspace` while a v-drag element is selected (and no
  text-edit context has focus).
- **Effect**:
  - Strip the source line(s) for the element from the slide's markdown — this
    is the source of truth, the dragPos entry is just a position cache.
  - Drop the `(slideNo, dragId)` entry from `slides.coords.yaml` (and the
    materialized state in `state.db` so the SSE broadcast removes the bb
    from other tabs).
  - Push an `Edit` event with `kind: 'delete'` to the event log so undo
    brings it back (re-insert the source line + restore the dragPos entry).
  - Clear the selection.
- **Confirmation**: none for the first cut — the action is undoable so a
  modal dialog would just be friction. If users complain about accidental
  deletes, add a 4-second "Undo" snackbar like Gmail.

### Source-line removal

For each supported element type, identify the source line(s):

- **`<Tweet …>` / `<Youtube …>` / `<BlueSky …>`**: single line, easy. Use the
  existing `markdownSource` payload that VDrag already threads through
  (`packages/client/composables/useDragElements.ts:DragElementMarkdownSource`)
  — it carries `slideNo` + line range.
- **Markdown images** (`![](…)`): single line. Same payload, but the line may
  be inside a paragraph — removing it could leave a trailing blank line. Trim
  the blank if both neighbors are empty.
- **Manual `<v-drag>` blocks**: multi-line. The `markdownSource` payload
  already gives the line range (it's used by the source-map pipeline). Remove
  the whole range.

The line-range payload comes from the markdown-it plugin chain
(`packages/slidev/node/syntax/markdown-it/`); double-check that markdown
images and embed components both produce `[startLine, endLine]` consistently.
If `<v-drag>` blocks don't have it (they're parsed as raw HTML), add a
markdown-it plugin pass that annotates them with `data-md-line-start/end`.

### Server endpoint

Add `POST /__slidev/edit-source` to the existing state plugin
(`packages/slidev/node/vite/state.ts`) — body: `{ slideNo, op: 'delete-lines',
range: [start, end] }`. Mirrors how `/upload` writes back to disk. Recompute
the new slide and broadcast a `state-change` so other tabs re-fetch.

For delete, the operation is:
1. Read slide source.
2. Splice out the line range.
3. Write back via the same file-write path as `/upload`.
4. Remove the dragId from `state.db` (`DELETE FROM element_state WHERE
   slide_no=? AND drag_id=?`) and emit the `delete` event.
5. Broadcast SSE.

### Undo

Event entry stores `before = { sourceLines: string[], lineRange: [s,e],
elementState: ElementSnapshot }`. On undo:
- Re-insert the source lines at the original range.
- Re-insert the element_state row.
- Broadcast.

The existing history drawer should render `kind: 'delete'` with a trash icon
and the dragId.

## Scope (Stage 2: insert)

Probably best as a separate spec once Stage 1 lands. Sketch:

- Reuse the `i` keyboard shortcut to open a small picker modal — current
  behavior is "browse for image file". Extend with tabs for `Image`, `Tweet`,
  `YouTube`, `BlueSky`, with a single URL/ID input per tab.
- Validate the URL/ID (re-use BlueSky's `resolvePostUri`, Tweet's id regex,
  YouTube's v= regex).
- On confirm, append the appropriate tag to the slide source via
  `/__slidev/edit-source` (`op: 'append-line'` or `'insert-line-at'`).
- Drop in the deck at a sensible default position (centred + slight offset
  per existing element, so new items don't all stack on top of each other).

## Open questions

- **What counts as "selected" for the delete key?** The current
  `useMultiSelect` composable holds the selection set. Multi-select delete
  should be one event (group delete) so a single Cmd+Z brings everything
  back.
- **Cropped images** — does delete clear the crop too? Yes, since we're
  removing the source line entirely.
- **What about elements that have no markdownSource (e.g. dynamically
  rendered or rendered by the theme)?** Skip delete for them — they can't be
  removed from the source by line-range surgery. Show a brief toast: "This
  element isn't deletable from the slide source."
