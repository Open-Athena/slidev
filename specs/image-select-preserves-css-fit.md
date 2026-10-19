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
