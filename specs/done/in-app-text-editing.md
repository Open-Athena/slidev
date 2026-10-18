# In-app text editing

Ryan, prepping the disky deep-dive deck: "I don't want to have to edit slide text and positions in md". Positions were already editable in the app (v-drag → `slides.coords.yaml`); this adds text. Markdown stays the source of truth; the app edits it for you.

## As built

- **Source mapping** (`node/syntax/source-lines.ts`): a markdown-it core rule that runs in dev with the editor feature on (builds render unchanged). It tags headings, paragraphs, list items (with their first paragraph's lines) and table cells (row line + `data-slidev-md-cell`) with `data-slidev-md="start,end"`. Coordinates are the slide's markdown content, the same as `/__slidev/slides/<n>.json` and `v-drag`'s `markdownSource`, mapped back through each slide's transform source map.
- **Editing** (`composables/useTextEditing.ts`, mounted by `play.vue` in dev):
  - In edit mode, double-click a tagged block.
  - **Rich mode** (in place, `contenteditable`) applies when serializing the rendered DOM back to markdown reproduces the source text exactly. ⌘B / ⌘I work, and paste is plain text.
  - **Raw mode** is a markdown textarea over the block, used otherwise or with ⌥ held.
  - Enter saves; Shift+Enter is a line break (raw: a soft break); Esc cancels; clicking away saves.
  - A bare programmatic blur cancels: Vimium's Esc blurs the field before the page sees the key.
- **Pure logic** (`composables/text-edit.ts`):
  - **Block text and markers:** prefix parsing for headings, list markers, task boxes and blockquotes; continuation lines; setext headings.
  - **Table cells:** GFM rows, with escaped pipes.
  - **Serializer:** inline DOM → markdown. It handles `strong`/`b`, `em`/`i`, `code`, links and autolinks, `del`, `u`, and `<br>`, straightens typographer quotes, and returns `null` for anything else.
  - **`spliceLines`:** content-matched replacement, for undo / redo.
  - **`looksLikeSameBlock` guard:** an edit is refused (red flash) if the rendered text doesn't plausibly come from the mapped lines, so a mapping bug can't overwrite the wrong lines.
- **Saving:** POST the slide's new content (HMR re-renders), then record a `text` history event, whose `source` holds `{ lineRange, lines (before), after }`. ⌘Z / ⌘⇧Z swap them back by content match, and the history drawer lists the event with the new text. Before saving or cancelling, the block's original DOM nodes are put back (the nodes Vue holds references to, not equivalent copies), so the HMR patch applies cleanly.
- **Shortcuts:** `isInputting` now counts `contenteditable`, so slide hotkeys don't fire while typing.

**Coverage on the deep-dive deck** (41 slides): 253 of 259 text blocks qualify for rich editing. The other 6 correctly fall back to raw: paragraphs that are just an image, `\[`, and `&#123;` / `&nbsp;` entities, which are left raw on purpose since `{{` would be Vue interpolation. No block mapped to the wrong lines.

**Tests:**
- `test/text-edit.test.ts` covers the pure helpers.
- `node/syntax/source-lines.test.ts` covers the emitted attributes.
- `cypress/e2e/examples/text-edit.spec.ts` (fixture page 25) covers:
  - edit mode off;
  - a rich list-item edit;
  - formatting kept;
  - Esc;
  - a table cell with pipe escaping;
  - raw mode;
  - ⌘Z.

  Each test restores the slide's source afterwards.

## Not yet

- **Text inside components:** text in custom components, raw HTML blocks or `<v-drag>` boxes covered by the selection overlay can't be edited this way.
- **Richer formatting:** a toolbar (links, code, lists), and splitting or merging blocks on Enter / Backspace.
- **Built decks:** no editing in built decks. An admin-only write path (oa/auth gate in a Worker, committing to the deck repo) is the plan for live edits on a published deck; see the discussion in the 2026-10-18 session.
- **Collaborative editing (Yjs):** not planned while markdown in git is the source of truth.
