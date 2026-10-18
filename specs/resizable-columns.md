# Resizable columns in Edit mode

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), 2026-10-18. Ryan: "i need to do a lot IA editing of copy and layout on these slides. can 50/50 2-col split be IA resizable?"

## Context

With Edit mode (`e`), in-app text editing and flow-mode image editing on `2a83b8f6`, the remaining layout edit the deck needs in-app is column widths. Two kinds of splits occur in the deck:

1. **Theme layouts**: `layout: two-cols` (theme `slidev-theme-open-athena`, `layouts/two-cols.vue`: `.cols-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px }`, a 1px divider on the second `.col`). Also `three-cols`, `four-cols`, `split-*`.
2. **Ad hoc grids in slide markdown**: `<div class="grid gap-6" style="grid-template-columns: 1fr 1.45fr">` (7 slides in the deck use an inline `grid-template-columns`; others use UnoCSS `grid-cols-2`).

## Ask

In Edit mode, hovering a column gap shows a drag handle (col-resize cursor, the divider highlights). Dragging it changes that slide's split live; release saves. Double-click the handle resets to the default (equal) split. Undo/redo and the history drawer record it like other edits.

## Where the value lives (markdown stays the source of truth)

- **Theme layouts:** a per-slide frontmatter key, e.g. `cols: 40/60` (or `cols: [2, 3]`), which the layout reads into `grid-template-columns` (fr units). Layouts belong to the theme, so either (a) the fork's client applies a CSS variable `--slidev-cols` on the layout root that themes opt into (`grid-template-columns: var(--slidev-cols, 1fr 1fr)`), with a PR to `Open-Athena/oa-slidev-theme`, or (b) the fork overrides `grid-template-columns` on the element it detects as the layout's grid. (a) is cleaner; pick it unless it blocks.
- **Ad hoc grids:** rewrite the element's inline `grid-template-columns` in the slide's markdown, located the way text editing locates blocks (source-lines mapping; refuse if the `style` attribute isn't found exactly once in the mapped lines, like text edits refuse non-unique matches). Grids that use a class (`grid-cols-2`) get an inline style added.
- Values round to 2 decimals of fr (or whole percent), with a min column width (e.g. 15%) so a drag can't collapse one.

## Notes

- Snap to common ratios (1/3, 1/2, 2/3, golden), holding ⌘ to disable snapping (the fork's convention everywhere else; ⌥ already means raw-markdown text editing).
- Flow-mode images inside a column should re-measure on resize (they already observe their container?).
- Not in built decks (same as other edits) until the admin write path exists.
- Tests: Cypress on a fixture slide for each kind (theme two-cols via frontmatter; inline grid) asserting the exact rewritten frontmatter/markdown line, plus undo restoring it byte-for-byte.
