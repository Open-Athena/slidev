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

## As built

**§1 Nudges.**
- **Cause:** arrow nudges ran on a 20 ms `useIntervalFn` while a key was held (via `magicKeys`), so a tap moved 0–2 px depending on timing. They also never opened a history entry, and ⇧+arrow was free for slide navigation (`prev_shift` / `next_shift`).
- **Now:** `DragControl.vue` handles arrow `keydown`s in the window's capture phase.
  - Each press, including auto-repeat, moves the element's rounded left / top edge by exactly 1 slide px, or 10 with ⇧. The written position is integer and opposite nudges cancel byte-for-byte.
  - ⇧+arrow no longer reaches slide navigation; ⌘ / Ctrl / ⌥+arrow still go to other shortcuts (z-order).
  - Every nudge calls `saveSnapshot('move')`, and the history's existing 150 ms commit debounce coalesces a burst into one entry.
  - Positions are written in whole px, never converted to %, so the spec's px-vs-% concern didn't apply.

**§2 ⌘Z.**
- **Root cause:** unrecorded nudges, so ⌘Z undid an older edit on another slide and `ensureSlide` jumped there.
- **Now:**
  - `undo()` / `redo()` first flush pending (debounced) edits and await in-flight commits (`flushPendingEdits`), so ⌘Z right after a nudge undoes that nudge.
  - When the target edit is on another slide, the first press only shows a notice (`composables/notice.ts`): "The latest edit to undo is on slide 7 (…). ⌘Z again to go there and undo it." A second press within 4 s goes there. This is the spec's second option; per-slide undo would need non-linear undo in the event log.
- **Why nothing reached disk:** position edits live in `.slidev/state.db` until "Commit to YAML" (Stage 3a of `deck-state-storage.md`). The commit button's orange dot is now a count of edits not yet in `slides.coords.yaml`, with a tooltip saying where they are.
- **Open question for Ryan:** auto-commit positions to YAML on each edit, now that text and column edits write markdown directly.

**§3 Column squeeze** (option (a), plus a CSS guard):
- A flow-layout `<img>` gets `max-width: 100%`. A replaced element with a percentage max size contributes zero to its grid track's min-content width, so it can no longer widen its column, even with sizes stored before this fix.
- Resizes of a flow-layout element clamp its width to its slot's content width (`flowSlotWidth()`, captured at pointerdown; applied in `getSize` for corners and in the left / right border branches).
- Selecting a flow image stored wider than its slot fits the stored size to the slot, keeping its left edge and aspect ratio, so the selection matches what's rendered.

**Tests:** `cypress/e2e/examples/edit-history.spec.ts`:
- ← → ↑ ↓ and ⇧ variants return to the exact recorded position, and ⇧+arrow doesn't change slides;
- ⌘Z undoes a nudge without changing slides;
- cross-slide ⌘Z shows the notice, stays put, then goes there and undoes on a second press;
- an image in a `1fr 1fr` grid (fixture slide 28) resized far past its column leaves both columns at exactly half the grid.

TFFP:
- the cross-slide test fails with the confirmation disabled;
- the clamp test fails without the clamp and cap: the columns end up 74 vs 1182 px.

Along the way: the text-edit, column-resize and these specs used to poll with `cy.wrap(null).should(() => fetch(…).then(expect))`. Cypress doesn't await a promise returned from a `should` callback, so those checks may never have run. They now use `cypress/poll.ts`'s `expectEventually` (`cy.request` + retry).

Verified with real keys / drags in Chrome:
- ⇧→ ⇧↓ ⇧← ⇧↑ on the deep-dive deck's slide 3 image returns to `554,107,381,277` on `/3`;
- on fixture slide 28, an image stored at 747 px renders at its 499 px slot, and enlarging it stops at the slot with the left column unchanged.
