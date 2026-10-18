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

## As built

- **Handle** (`composables/useColumnResize.ts`, dev + edit mode, mounted by `play.vue`): hovering within a column gap (at least 12 px wide) of a qualifying grid shows a fixed-position handle; the innermost grid under the pointer wins. Dragging previews live via the element's inline `grid-template-columns`, with a label (`40 / 60` for layouts, `1fr 1.45fr` for HTML grids, plus the snap ratio). Release saves; Esc cancels; double-click resets to equal columns. Minimum column width: 15% of the grid (or half an equal share, for many columns).
- **Snapping** to ⅓, φ (0.382 / 0.618), ½ and ⅔ of the pair's width within 8 screen px; **⌘ turns it off** (the fork's convention; ⌥ already means raw-markdown text editing).
- **Theme layouts** (option (a)): `SlideWrapper` sets `--slidev-cols` from frontmatter `cols` (`40/60`, `30/40/30` or `[2, 3]` → `40fr 60fr`). A layout opts in with `grid-template-columns: var(--slidev-cols, 1fr 1fr)` and a `data-slidev-cols` marker on the grid. Done for the built-in `two-cols` / `two-cols-header`, and for the OA theme's `two-cols` / `three-cols` / `four-cols` (`oa-slidev-theme` branch `cols`, `9ea5eed`). Saved as whole percents summing to 100; reset deletes the key.
- **HTML grids**: `node/syntax/source-lines.ts` tags block-level HTML tags (`div`, `section`, …, skipping comments) in markdown HTML blocks with `data-slidev-html="<line>:<k>"`, the k-th such tag on that source line. A grid qualifies when its inline template is all flexible tracks (`fr`, `minmax(0, fr)`, `repeat`) or it uses a `grid-cols-*` class; stylesheet-set templates may hide `auto` / fixed tracks, so they're skipped. The save rewrites only the opening tag's `grid-template-columns` (adding a `style` if needed), as `fr`s with the narrowest at `1fr`, 2 decimals. It refuses (red flash) if the source tag's name / classes don't match the element.
- **History**: a `cols` event kind. HTML grids record before / after lines (undo / redo splice by content, as text edits do); layouts record `{ frontmatter: { key: 'cols', before, after } }` and undo / redo POST the frontmatter value back.
- **Not built**: `split-*` layouts (no grid); grids whose columns come from a `<style>` block; touch.

**Tests**: `test/grid-cols.test.ts` (parsing, formatting, pair resize, snapping, tag rewriting); `source-lines.test.ts` (HTML tagging); `cypress/e2e/examples/column-resize.spec.ts` on fixture slides 26 (`two-cols`) and 27 (inline grid): no handle outside edit mode, layout drag → `cols: 60/40` and re-rendered split, ⅓ snap, HTML drag → exact rewritten line, double-click reset (TFFP: the handle used to hide after the reset's first click), ⌘Z restoring the source byte-for-byte. Verified with real drags in Chrome on the deep-dive deck (slide 3 `two-cols`, slide 14 inline grid).

**Caveat** (see `specs/edit-mode-nudge-undo-columns.md` §3): `Nfr` tracks are `minmax(auto, Nfr)`, so wide content (e.g. an enlarged image) can still widen its column past the split.
