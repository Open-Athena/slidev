# Edit mode: selecting a CSS-sized image must not change what's visible

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`, slide "Space Gremlin"), 2026-10-18, fork `1c72b9ad`.

## Repro

The slide is a collage of absolutely positioned `<img>`s sized by a class, with `object-fit` / `object-position` in a slide `<style>`:

```css
.sg-collage img { position: absolute; object-fit: cover; margin: 0; }
.sg-hero { left: 0; top: 50%; width: 43%; height: 50%; object-position: 0 6%; }
.sg-pro  { left: 77%; top: 0; width: 23%; height: 55%; object-fit: contain !important; background: #2a2725; }
```

In Edit mode, clicking one of these images re-frames it at the image's **natural aspect ratio**. The visible region changes on selection alone: a `cover` crop is undone, and a `contain` box loses its background fill and shifts. Ryan: "when i click on it … they get cropped down".

After a move or resize, the editor writes an inline `left/top/width/height` plus a `clip-path: inset(…)` (seen in `element_state` for `sg-pro` / `sg-intel`). The rendered result therefore depends on the editor's crop model, not the slide's CSS.

## Ask

- **Selecting must be a visual no-op.** When the editor takes over an image, capture its current rendered box (`getBoundingClientRect` in slide coordinates). Translate the effective `object-fit` / `object-position` into the editor's crop model, with the visible source sub-rectangle as the crop, so the first frame after selection is pixel-identical to before.
  - `cover` with `object-position`: compute the visible sub-rect from the box AR vs. the natural AR, plus the position percentages.
  - `contain`: the content box is smaller than the element. Either keep the element box and letterbox (preserving `background`), or select the content box. Keep the element box unless that complicates the crop model.
  - `fill` / no fit: as today.
- **Writes keep the same look.** After a move or resize, the persisted state (inline style + `clip-path`) must reproduce what the user saw. Add a test that selects, nudges ← →, and compares screenshots against the starting state.
- **Show where edits are saved.** Edits live in `.slidev/state.db` until the commit button writes `slides.coords.yaml`. Ryan didn't realize his image edits weren't on disk, and the deck gitignores `.slidev/`. Make the uncommitted state obvious (the commit button's dot, maybe a count badge), and consider auto-committing on leaving Edit mode.

## Tests

A Cypress fixture slide with three class-sized absolute images (`cover` + `object-position`, `contain` + background, no fit). For each, the screenshot after selecting equals the screenshot before. After a move and back, the stored state renders identically.

## Deck workaround (until fixed)

The deck padded `space-gremlin-body` to its box's AR (`space-gremlin-body-pad.png`), so the natural and rendered boxes match. The other three collage images still hit this.

## Related: `element_state` is keyed by slide number

Ryan inserted a slide ("Prompt", now slide 3) by editing `slides.md`. `element_state` rows stayed on their old numbers:

- The slide-3 row for `img-percy-russell-discord-0813` came from what is now slide 4, "Marin GCS Usage", which shows that image small in its right column. It now applies to the new Prompt slide's full-width copy of the same image, so that renders at a stale 476×203 box on the right.
- Slide 2 (Outline) has a stale row too.
- Space Gremlin's rows exist under both 5 (old) and 6 (new).

The overview reorder (`bf9218b6`) renumbers state, but a markdown insert or delete doesn't. Key state by a stable slide identity (slug or a content hash of the frontmatter / title), or remap rows by matching each slide's image set when the slide list changes.

## As built

### Selecting a CSS-fitted image

Chose to **translate the CSS fit into the editor's crop model** (not to preserve the CSS fit), for absolutely-positioned images. On first select, `startDragging()` computes where the picture renders relative to its box (`renderedImageRect`, now covering `fill` / `contain` / `scale-down` / `cover` / `none`), and `imageFitAsCrop` turns that into a box at the picture's own AR plus a crop (percentages) hiding what the element's box clipped. Why:

- A box at the picture's AR renders the same under any `object-fit`, so the stored state no longer depends on the slide's CSS fit.
- Crop mode then shows the whole picture with the hidden parts dimmed, and the crop handles can reveal them. With the CSS fit kept, crop mode could only shrink the already-cropped frame.
- An AR-locked resize scales the picture and its crop together, instead of CSS re-cropping on every resize.

Rules (`useDragElements.ts`, `startDragging`):

- `cover`, or `none` with a picture larger than its box: the box grows to the whole picture, and the overflow is cropped.
- Letterboxed (`contain` / `scale-down`): the box shrinks to the pixels, as before, unless the box is **decorated** (`isBoxDecorated`: a non-transparent background, a background image, a border, a shadow or padding). In that case the bands are visible, so the box is kept and the CSS fit goes on fitting the picture into it. This is the spec's `contain` + `background: #2a2725` case.
- `fill`: unchanged.
- Flow-layout elements keep their box when the picture overflows it, since growing a flow box would reflow its neighbors. They still shrink to the pixels when letterboxed and undecorated, as before.

Also:

- `parseObjectPosition` understood only keywords and `%`. `getComputedStyle` serializes `object-position: 0 6%` as `0px 6%`, and `0px` fell back to centered. It now returns `{ fraction, px }` per axis, and handles px lengths and the 3–4-value edge-offset form (`right 10px bottom 20%`). `calc()` still centers.
- Crop percentages in `posStr` (the client watcher and `snapshotToPosStr`) are rounded to 2 decimals instead of whole percents. 1% of a large image is several pixels, so a `slides.coords.yaml` commit would otherwise move the crop edges. Older files still parse.

The not-yet-committed indicator was already on the commit button (a count badge, plus a tooltip naming `.slidev/state.db`). Auto-commit on leaving Edit mode was not done.

Tests:

- `test/drag-layout.test.ts`: `renderedImageRect` (`cover` / `none` overflow), `imageFitAsCrop` (cover, letterbox, mixed), `parseObjectPosition` (px, edge offsets, fallback), `isBoxDecorated`.
- `test/posstr.test.ts`: 2-decimal crop.
- `cypress/e2e/examples/image-fit.spec.ts` uses fixture **slide 32** (`SLIDE` constant). The slide is a collage like Space Gremlin's, with `quadrants.svg` at 400×300: `cover` + `object-position: 0 25%`, `contain !important` + background, and `fill`. For each image it screenshots `#slide-content` before, after selecting, after a ← → nudge and after a reload from the DB, then compares pixels in the browser. `contain` and `fill` match exactly. `cover` differs only in the one device-pixel row along each crop edge: anti-aliasing of the unsnapped `clip-path` edge, where the box's own edge was pixel-snapped. Without this change, `contain` differed in 54,896 pixels (background lost). Before the `renderedImageRect` change, `cover` already matched, because the CSS fit kept applying to the unchanged box. The deck's `cover` symptom may have had another cause (e.g. a stale `element_state` row, see below), which this fixture doesn't reproduce. A fourth test checks the `cover` box: 344×258 with `clip-path: inset(6.58915% 0% 19.7674%)`.

### `element_state` follows its slide when `slides.md` changes

Chose to **remap rows by matching slides when the slide list changes**, rather than keying state by a stable slide identity. Re-keying would mean a schema and client-registry migration, and slugs or titles aren't stable across edits either. `handleHotUpdate` in `vite/loaders.ts` compares the old and new slide lists (`remapSlideState`) and renumbers `slides.coords.yaml` and the DB. It then redoes `newData`'s applied `dragPos` from the renumbered coords, because `loadData` applied them under the old numbering.

Matching (`matchSlides` in `slide-order.ts`, pure). A slide's key is a sha1 of its content plus its frontmatter without `dragPos`, plus its title.

1. Slides with identical signatures pair up, in order, when the signature occurs equally often before and after. A duplicated slide doesn't pair, since either copy could be the original.
2. The longest order-preserving run of those pairs anchors everything else; pairs outside it are moves.
3. Within each gap between anchors, slides pair by unique title. Those pairs split the gap further, and in each part the remaining slides pair by position when the counts are equal (in-place edits, including retitles). Old slides left over are `removed` if their part has no new slide left, else `ambiguous`.

Safety:

- If any **ambiguous old slide has state** (element state, history, or coords), nothing is touched and a warning names the slides. An ambiguous slide with no state is treated as removed.
- A removed slide's positions are **parked**, not dropped. They go into the new `parked_state` table, keyed by the slide's signature, with its `element_state` row and its `slides.coords.yaml` entry. When a slide with that signature is added back, they're restored, with a `hydrate` event labelled `restored-with-slide`. This covers a cut and a paste in two separate saves.
- A removed slide's events move to slide 0 and are abandoned. Otherwise undo, redo or restore would replay them onto whichever slide now has that number. `renumberSlides` does this for any slide `order` doesn't map, and `Slot.from` may now be `null` (a new slide).
- The overview's reorder endpoint already renumbers state before writing the markdown. Its write is recorded (`reorderWrite`), and the hot update for it skips the remap, so nothing gets renumbered twice.
- Each remap is logged on the server (moves, parked, restored).
- Clients get a `remap` SSE broadcast after the new data is in place, and **reload**. Mounted elements are registered under their old slide numbers, and HMR can patch a slide's elements in place rather than remount them, so re-keying them live would be more error-prone than a reload. An edit still in its 150 ms commit debounce at that moment is dropped, since posting it would land on the old slide number.

Tests:

- `test/slide-order.test.ts`: `matchSlides` covers identity and in-place edits, inserts and removals, moves, title disambiguation (including the spec's Prompt / Outline / Gremlin shapes), ambiguity (an insert next to an edit, a duplicate) and repeated identical slides. Also `isIdentityOrder`.
- `test/state-core.test.ts`: `remapSlides` shifts state and coords past an insert; a cut then paste parks the positions, abandons the history and restores both (and only once); `slidesWithState`.
- `cypress/e2e/examples/slide-state-remap.spec.ts` (fixture slide 32). It moves `fit-fill`, then rewrites `slides.md`: inserting a slide before 32 moves the state to 33, removing the insert brings it back to 32, and removing slide 32 itself and restoring it parks and then restores the position. Each test restores the markdown.

Not done or risky:

- Matching runs on every markdown hot update. It's O(n²) in slides for the anchor run, which is fine for decks of hundreds of slides.
- Without `better-sqlite3`, coords are still renumbered, but removed slides' coords can't be parked and are dropped.
- `copy-paste.spec.ts` fails when run after `edit-history.spec.ts` in the same run, with and without these changes. `edit-history` leaves `box1` moved 3px. CI runs them in alphabetical order, so `copy-paste` goes first there.
