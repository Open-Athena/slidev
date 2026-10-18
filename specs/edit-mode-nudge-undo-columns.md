# Edit mode: reversible nudges, ⌘Z, and images widening grid columns

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`, fork `d345d155`, `draggableImages: all`), 2026-10-18, slide 3 ("Marin GCS Usage": `layout: two-cols`, three flow-layout `<img>`s stacked in `::right::`).

## 1. Arrow nudges aren't reversible

Ryan selected the middle image, pressed ← then →, and it did not land back where it started. Nudges should be discrete and deterministic:

- A nudge moves by a fixed step in the unit the source stores (whole px, or a fixed % step), never a px step converted to % of a measured container and rounded back.
- ← then → (and any sequence summing to zero) restores the exact original value, so the written markdown is byte-identical to before.
- ⇧+arrow: a larger fixed step (e.g. 10×), with the same guarantee.
- Test: Cypress on a fixture slide, nudge ← → ↑ ↓ (and ⇧ variants), assert the source line equals the original exactly.

## 2. ⌘Z went two slides ahead instead of undoing

After the nudges, ⌘Z didn't undo them: the deck navigated two slides ahead, to a slide visited recently. Possibly undo jumps to the slide holding the history's latest entry, which would mean the nudges weren't recorded as edits.

Also, nothing from this session reached disk: `git status` in the deck stayed clean after the nudges and after the resizes in §3. Check whether flow-layout nudges and resizes save at all, or only on some later event, and make that visible (e.g. a "saved" / "unsaved" state in the Edit-mode toolbar).

Expected:

- In Edit mode, ⌘Z / ⇧⌘Z undo / redo edits and never navigate on their own.
- If the latest history entry is on another slide, either undo the latest entry on the current slide (preferred: per-slide undo is what people expect while editing one slide), or show which slide the undo will apply to before jumping.
- Every nudge and resize is one history entry, and gets written to the source.

(Jump-history navigation is a separate deck-level feature: the deck now binds ⌥← / ⌥→ through use-kbd. ⌘⌥← / ⌘⌥→ would collide with Chrome's tab switching on macOS.)

## 3. Enlarging an image in a column squeezes the other column

Ryan clicked each of the three right-column images and ⇧-resized them larger. The left column's text then wrapped onto more lines and overflowed the slide. He took it for the text getting bigger, but the font size was unchanged: the left column got narrower.

Cause: `two-cols` is `grid-template-columns: 1fr 1fr`. `1fr` is `minmax(auto, 1fr)`, so a column's min-content width (here, the images' explicit widths) widens that track at the other track's expense.

Expected: resizing a flow-layout image never changes its container's layout. Options:

- (a) Clamp the resize to the container's content width, and write `max-width: 100%` with it.
- (b) Write the size as a % of the container rather than px.

Pick (a) unless (b) falls out more naturally from the existing size format. Changing the theme to `minmax(0, 1fr)` would stop the squeeze, but then an oversized image overflows its column instead. Resizing a column on purpose is `specs/resizable-columns.md`.

## Tests

- Nudge reversibility (§1).
- ⌘Z in Edit mode on a slide with an edit: the source is restored, and the current slide doesn't change (§2).
- Resize an image in a `two-cols` fixture past its column width: the other column's width (getBoundingClientRect) is unchanged, and the written size is clamped (§3).
