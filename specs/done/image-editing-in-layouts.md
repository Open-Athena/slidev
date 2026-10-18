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


## As built

All four gaps are fixed, confirmed in headless Chromium against the deep-dive deck (slides 3, 4 and 11). The interactive Chrome extension was unavailable.

- **Flow layout** (`useDragElements.ts`): a new mode, enabled by `v-drag.flow`, `<v-drag flow>`, or frontmatter `dragLayout: flow` (deck-wide via `defaults:`).
  - Unpositioned flow elements get no inline style, so they render exactly as authored.
  - Once positioned, they use `position: relative`, with `left`/`top` measured against their own layout slot. The slot is found from `offsetLeft` minus the applied offset, so neighbors never reflow on a move.
  - A resize changes the slot's size (and so may reflow the column), which is the "resize in place" the proposal asked for.
  - `flex-shrink: 0` and zero horizontal margins keep a fixed width from being squeezed, or from widening a grid column. The theme's inline-image `margin: 0 0.15em` widened the column by 5px.
  - Elements whose author already positioned them (e.g. `class="absolute right-8"`) are detected at mount from the author's computed `position` and keep absolute semantics.
- **Offset origin** (gap 3, both modes): CSS offsets subtract the `offsetParent`'s padding-box origin within the slide. That comes from `paddingOriginWithin` in `composables/drag-layout.ts`, which walks the `offsetParent` chain, so ancestor transforms (slide scale, enter animations) don't distort it. It's re-measured on mount (in every render context, so overview and print agree), on `ResizeObserver` hits (element, parent, slide), and after each style change.
- **Letterboxed crop** (gap 4): on first select, an `<img>` with `object-fit: contain`/`scale-down` gets a box fitted to its rendered pixels (`renderedImageRect`, which honors `object-position`). Crop then clips pixels. Positioned elements also get `height: auto` (for auto-height) and `max-width`/`max-height: none`, so layout CSS like `height: 100%` or `max-h-72` can't fight the stored size.
- **Deck-wide switch** (gap 1): `draggableImages: all` adds `v-drag.flow="'img-<name>'"`:
  - to markdown images;
  - to raw HTML `<img>` tags;
  - to the components named in the new `draggableImageTags` (e.g. `[Scrn]`; a directive on a single-root component reaches its root `<img>`).

  Ids come from the `src` basename, with a per-slide counter shared with markdown images. `draggableImages: true` is unchanged (markdown only, absolute).
- **Directive style cleanup:** `v-drag` now clears inline style keys a later style drops, e.g. `left` after an undo back to unpositioned.

Not done: crop/resize while still unpositioned. The first select always positions the element, which in flow mode is invisible, so no separate in-place mode was needed.

Tests:
- `test/drag-layout.test.ts`: origin chain, letterbox rects, `object-position` parsing.
- `draggable-image.test.ts`: the `all` mode, ids shared across markdown and HTML, look-alike tags left alone.
- `cypress/e2e/examples/v-drag-flow.spec.ts` (fixture page 24, a two-column grid with letterboxed images):
  - renders as authored before any edit;
  - select fits the pixels without moving the neighbors;
  - drag moves only the element, and the position survives a reload.

[dragpos-persistence.md]: ../dragpos-persistence.md
[v-drag-position-format.md]: ../v-drag-position-format.md
