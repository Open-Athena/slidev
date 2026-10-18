# In-app image editing for `<img>` / components inside layouts (two-cols, grids)

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`). Ryan wants to crop, resize and position the deck's screenshots in the app. The fork's editor ([dragpos-persistence.md], [v-drag-position-format.md]) works on markdown images in free-positioned slides. This deck's images are raw `<img>` and a `<Scrn>` component (a themed `<img>`), inside the theme's `two-cols` slots and CSS grids, and nothing in the editor reaches them.

## Gaps (from reading the code; confirm in a browser first)

1. **Opt-in:** `draggableImages: true` only rewrites markdown `![]()` (`node/syntax/draggable-image.ts`). Raw `<img>` and components need a hand-written `v-drag="'id'"`, and nothing documents whether `v-drag` on a component reaches its root element.
2. **Out of flow:** once an element has `v-drag`, it switches to `position: absolute` straight away (`composables/useDragElements.ts`, around the absolute-positioning branch). An image laid out by a grid or flex container drops out of the layout and overlaps its neighbors, before any edit has happened.
3. **Offset origin:** the open-athena theme's `two-cols` sets `.col { position: relative }`. Coordinates saved in slide space are then applied relative to the column, so a committed position lands somewhere else on reload.
4. **Letterboxed crop:** the theme gives column images `height: 100%; object-fit: contain`. Crop is a CSS `clip-path: inset(%)` on the element box, so on a letterboxed image the percentages clip the empty bands, not the pixels.

## Proposal

- **Layout-preserving mode** (the default for elements with no stored position): editing starts from the element's current box. Crop and resize apply in place (`clip-path`, plus `width`/`height`, or `object-view-box` where supported). The element switches to `position: absolute` only once the user drags it to move, and then with coordinates measured against `offsetParent`, not the slide root.
- **Crop in image space:** compute the inset against the rendered image rect (account for `object-fit`/`object-position`), or set `object-fit: fill` + `height: auto` on the element while it has a crop.
- **One switch for a whole deck:** `draggableImages: 'all'` (or a deck-level flag) attaches `v-drag` to every `<img>` in a slide, raw HTML included, with ids derived from slide number + `src` (stable across reorders within a slide). Components opt in with `v-drag`, applied to their root `<img>`.
- **Storage stays as it is:** crop fields in `slides.coords.yaml` (non-destructive), committed via "Commit to YAML".

## Tests

- **Two-cols:** on a fixture slide with `<img v-drag>` in a two-cols column, opening the editor without moving leaves the bounding box unchanged.
- **Crop round-trip:** cropping 10% off each side on a letterboxed image clips image pixels (sample a corner pixel). Reloading reproduces the same box.
- **Deck-wide switch:** with `draggableImages: 'all'`, every raw `<img>` on the slide is selectable, and ids stay stable when an unrelated slide changes.

[dragpos-persistence.md]: dragpos-persistence.md
[v-drag-position-format.md]: v-drag-position-format.md
