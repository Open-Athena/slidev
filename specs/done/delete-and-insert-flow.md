# Delete + insert flow for slide objects

## Status

Followup spec from the embed-polish work. Filed because the user typed
Backspace on a `<BlueSky>` embed and expected it to disappear, and noticed
there's no other way to add a new embed/image to a slide besides hand-editing
markdown.

- **Stage 1 (delete) — done.** Backspace/Delete strips the selected element's
  source line(s) (`e5068ac9`), and deletion now round-trips through the SQLite
  event log as a `kind: 'delete'` event so Cmd+Z re-inserts the exact removed
  lines (undo) and Cmd+Shift+Z re-removes them (redo). The splice context
  (`lineRange` + `lines`) rides on the event payload; see `pushDelete` /
  `applyDeleteSplice` in `useDragHistory.ts` and `sliceLineRange` /
  `findLineRun` in `delete-source.ts`. Deferred within Stage 1: stale
  `slides.coords.yaml` dragPos cleanup (harmless leftover) and single-event
  group delete (still deferred; see "As built (Stage 2)" below). The toast for
  un-deletable elements landed with Stage 2.
- **Stage 2 (insert) — done.** The `i` picker has Image / Tweet / YouTube /
  Bluesky tabs; embeds are validated, appended to the slide as one undoable
  `text` event at a default position, and selected. See "As built (Stage 2)".

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

## As built (Stage 2)

### Picker

`internals/InsertImageDialog.vue` (still opened by `i`, edit mode only, via
the existing shortcut gate) has four tabs: **Image** (the file upload, as
before), **Tweet**, **YouTube** and **Bluesky**. The tab is remembered for the
session; the Image tab still opens the OS file picker on open, the others
focus a URL field. Input is validated as you type (red border + message), a
valid one shows the markup that will be inserted, and Enter or "Embed"
inserts it. A picker no longer closes when an embed's iframe takes focus
before the picker has it (it closes only when focus moves *out* of it), and
closing blurs its field so shortcuts work again.

Parsing (`composables/embed-insert.ts`, pure, `test/embed-insert.test.ts`)
reuses the components' own helpers, now in shared modules:

- **Tweet**: numeric id, or an x.com / twitter.com status URL via
  `resolveTweetId` (`logic/tweet.ts`). Inserted as `<Tweet id="…" />`, never
  `url=`: `Tweet.vue`'s dragId is `tweet-${id}`, so `url=` alone would give
  `tweet-undefined`.
- **YouTube**: new `resolveYoutubeId` (`logic/youtube.ts`): bare 11-char id,
  `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/`, nocookie hosts.
  Inserted as `<Youtube id="…" />` (dragId `yt-<id>`).
- **Bluesky**: `bsky.app/profile/…/post/…` URLs and `at://…/app.bsky.feed.post/…`
  URIs. `extractPostInfoFromUrl`, `RE_AT_POST_URI` and the dragId derivation
  moved out of `BlueSky.vue` into `logic/bluesky.ts` (`isBlueSkyPost`,
  `blueSkyDragId`), which `BlueSky.vue` now imports. Validation is
  syntactic only; the network resolve (`resolvePostUri`) still happens in the
  component. Inserted as `<BlueSky uri="…" />` (dragId `bsky-<post id>`).

An embed's id comes from the post / video, so inserting one already on the
slide is refused ("Already on slide N (id)").

### Insertion, position, undo

`composables/useInsertElements.ts` `insertElements(slideNo, items)` is the
shared path, factored out of `insertCopies` in `useCopyPaste.ts` (which now
uses it): append each snippet at the end of the slide (`appendSnippet`, so
auto ids keep their order), seed `initialState` with the positions, record
one `pushTextEdit(slideNo, changedRange(before, after), positionItems)`,
POST the slide, then select the new elements once they render (not awaited,
so the picker closes right away). One ⌘Z removes the whole insert.

Default position (`defaultPos`): centred on the slide, then 16 px
down-right per element already on the slide, wrapping back to the centre
before running off it. Sizes (`EMBED_SIZE`): YouTube 480×274, Tweet 400×300,
Bluesky 400×200; Tweet / Bluesky heights are placeholders the wrappers'
aspect lock replaces once the widget loads.

Image inserts (picker, drop, paste of a file or an image URL) go through the
same path via `appendToSlide`, so they're undoable too, and a multi-file
insert is one event. They aren't positioned or selected: the image's size
isn't known until it loads, so it stays where the layout puts it.

### Embeds and delete / copy

`findElement` (`element-copy.ts`) now maps the embeds' derived ids back to
their markup (`tweet-<id>` → `<Tweet … id="<id>">` / `:id`, `yt-<id>` →
`<Youtube … id>`, `bsky-<post>` → `<BlueSky … uri="…/<post>">`), so
⌫ deletes an embed (one text edit, undoable) — before this, embeds had no
source range and weren't found. ⌘C / ⌘D skip embeds with a notice, since a
copy would keep the original's id.

### Open questions, resolved

- **Toast for un-deletable elements**: `deleteSelectedElements` shows
  `showNotice("This element isn't deletable from the slide source")` (or
  "N elements aren't …") when an element's markup can't be found, e.g. a
  `<Youtube :id="'…'" />` whose id is a binding, or `<Tweet url="…" />`.
- **Group delete as one event**: left as is. Elements with a source range
  still emit one `delete` event each; elements found by markup emit one
  `text` event per slide. ⌘Z unwinds them one at a time. Folding both into a
  single event needs a combined splice payload; not worth it yet.

### HMR fix this needed

Inserting an embed exposed a dev-only bug: any slide edit HMR-updates that
slide's frontmatter module, and Vite stamps all its importers, transitively
(`#slidev/slides` → `useNav` → `useDragElements` / `useDragHistory` →
`VDrag.vue` → `Youtube.vue` …), with a new `?t=`. The re-fetched slide then
imports its builtin components at those URLs and gets *fresh copies* of
`useDragElements` / `useDragHistory`, with empty `initialState` and
registries, beside the copies the rest of the app uses. So a just-inserted
(or re-rendered) `<Youtube>` / `<Tweet>` / `<BlueSky>` / `<VDrag>` ignored
its seeded position and couldn't be selected. (`v-drag` directives weren't
affected: the directive is registered once at app setup.) Their module state
now lives in `import.meta.hot.data` (`composables/hmr-shared.ts`), shared
across a module's versions. `VDrag.vue` also sets `draggingState` on its
container, as the directive does, so `selectWhenRendered` finds it.

### Tests

- `test/embed-insert.test.ts`: `parseEmbed`, `resolveYoutubeId`,
  `isBlueSkyPost` / `blueSkyDragId`, `defaultPos`.
- `test/element-copy.test.ts` "embeds": `findElement` for embed ids,
  `isEmbedSnippet`.
- `cypress/e2e/examples/insert-embed.spec.ts` (fixture slide 32, which has a
  `<Youtube :id="'…'" />` with a bound id): validation, insert + position +
  selection + ⌘Z for YouTube; duplicate refused; Tweet and Bluesky inserts;
  ⌫ on an inserted embed and ⌘Z back; the notice for the un-findable one.
