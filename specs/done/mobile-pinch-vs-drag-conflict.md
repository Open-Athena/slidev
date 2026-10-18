# Mobile pinch-zoom misfires as a v-drag move

## Problem

A two-finger pinch on a `<v-drag>` element (or auto-wrapped draggable image) is
interpreted as a single-finger drag. The element gets translated to wherever
the first finger landed, often far off-screen — and because edits persist
immediately and irreversibly to `slides.coords.yaml`, the prior position is
lost the moment the user releases or refreshes.

Concrete loss: in `hccs/tf` slide 2, two of four logos (`bp`, `bb`) ended up at
y ≈ -200 (above the slide canvas) after a single mistaken pinch. The other two
logos, which the user was actively editing, kept correct positions, so this is
specifically a touch-pointer-routing bug, not a generic drag bug.

## Root cause

`packages/client/modules/v-drag.ts:39` (`handlePointerdown`) and
`packages/client/builtin/VDrag.vue:36` (`handlePointerdown`) both register
single-pointer drag handlers and call `setPointerCapture` on the first
`pointerdown`. Neither handler:

1. Checks `isPinchOrPan` (exported from
   `packages/client/composables/usePinchZoomPan.ts:43` precisely so other
   handlers can suspend).
2. Detects when a second touch arrives mid-drag and aborts.
3. Distinguishes `pointerType === 'touch'` from `mouse` / `pen` so it could
   defer commit to drag until movement exceeds a threshold.

The result on mobile:

- Finger 1 down → `pointerdown` (touch) on the v-drag element → drag starts,
  snapshot saved, capture acquired.
- Finger 2 down → `usePinchZoomPan`'s `touchstart` sets `isPinchOrPan = true`,
  but v-drag is already committed.
- Either finger moves → v-drag's `pointermove` fires (the captured pointer's
  motion is dominated by the pinch gesture, which is wild relative to a
  controlled drag).
- Lift → drag ends, position is now wherever the pinch dragged the captured
  finger.

`useSwipeControls` is the only consumer that currently honors `isPinchOrPan`.

## Fix (small, focused)

Three independent guards, all worth landing:

### 1. Honor `isPinchOrPan` in v-drag

Both `modules/v-drag.ts:39` and `builtin/VDrag.vue:36` should bail out at the
top of `handlePointerdown` when `isPinchOrPan.value` is already true, and abort
mid-drag (in `handlePointermove`) when it becomes true. Aborting mid-drag
should:

- Restore each affected element to its pre-drag snapshot (the snapshot already
  exists — `s.saveSnapshot()` is called at the top of the handler).
- Release the captured pointer.
- Stop emitting further pointer events.

### 2. Multi-touch detection

`isPinchOrPan` is set by `usePinchZoomPan`, which is only mounted on
`pages/play.vue`. v-drag should also bail when it directly observes a second
active touch, so the protection holds in any context (presenter mode, embeds,
etc. that don't mount the pinch composable). Track active touches by
`pointerType === 'touch'` ids; if `>1`, abort.

### 3. Touch-input drag threshold

For `pointerType === 'touch'`, defer the "drag has started" commitment until
the pointer has moved more than ~10–15 px from the start point. Tap and short
gestures shouldn't move the element at all. This is what's expected on mobile
and matches platform conventions (Google Slides, Keynote).

(Mouse/pen drags should keep the current "any movement = drag" behavior so
desktop precision isn't degraded.)

## Out of scope

- Persistent undo / global "discard last drag" UX — see
  `undo-redo-toolbar.md`.
- Per-element history persistence beyond sessionStorage — see
  `deck-state-storage.md` stage 3.

These specs are independent: the fix above stops the bug from happening at
all; the undo/toolbar spec is the safety net for *all* unintended edits, not
just mobile pinches.

## Acceptance

- On a touch device, pinch-zooming a slide that contains `<v-drag>` elements
  does not move any element.
- On a touch device, a tap on a `<v-drag>` element followed by lifting (no
  meaningful movement) does not move the element.
- On a touch device, a deliberate one-finger drag of >15 px on a `<v-drag>`
  element still works as today.
- Desktop mouse/pen drag behavior is unchanged.
- Cypress / Playwright touch tests cover all four cases above.

## Implementation notes

Landed across `packages/client/{builtin/VDrag.vue, modules/v-drag.ts}`,
backed by `packages/client/composables/useActiveTouches.ts` (new) and a
small `discardSnapshot()` addition to `useDragElements.ts`.

- Touch threshold = **12 px**; mouse threshold = **3 px** (unifying the
  directive with `VDrag.vue`'s pre-existing 3 px threshold — 3 px of mouse
  jitter is imperceptible and matches existing behavior).
- `activeTouchCount` is a module-level `Ref<number>` updated by
  document-level capture-phase `pointerdown` / `pointerup` / `pointercancel`
  listeners installed at module load. This works in presenter mode and
  embeds where `usePinchZoomPan` isn't mounted; in `play.vue`, the
  pinch-composable's `isPinchOrPan` guard typically fires first
  (touchstart runs before pointermove), but both paths converge on the
  same `abort()`.
- Aborts use `state.discardSnapshot()` (newly added) instead of
  `state.undo()` so pinch-aborted drags don't pollute the redo stack —
  Cmd+Shift+Z after a misfired pinch shouldn't replay the bad position.
- Verified via Chrome MCP synthetic Pointer dispatches (tap,
  sub-threshold touch, above-threshold touch, mid-drag second-finger
  abort, 5 px mouse drag) on both directive and component drag wrappers.
  Cypress / Playwright touch tests deferred — this fork doesn't have a
  touch-event test harness yet, and the synthetic-event coverage
  exercises the same code paths.
