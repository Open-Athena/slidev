// Unified body-drag pointer logic for `<v-drag>` directive (markdown images) and
// `<VDrag>` component (Tweet / Youtube / BlueSky / manual blocks). Both paths
// share the same selection set in `useMultiSelect`, so extracting the handler
// here means single-selection drags work identically and multi-select group
// drags work across mixed element types (image + embed) without further glue.
//
// The handler is invoked from each consumer's `pointerdown` listener. It owns
// the document-level `pointermove` / `pointerup` listeners for the duration of
// one drag, so the cursor can move over iframes / outside the slide without
// dropping the drag (pointerdown on the wrapper, but the pointer leaves the
// wrapper as the element moves with the cursor).

import type { DragElementState } from './useDragElements'
import { activeTouchCount } from './useActiveTouches'
import { pushEdit, pushGroupEdit } from './useDragHistory'
import { addToSelection, getSelectedElements, isSelected, removeFromSelection } from './useMultiSelect'
import { isPinchOrPan } from './usePinchZoomPan'

const MOUSE_MOVE_THRESHOLD_PX = 3
// Touch jitter is much larger than mouse jitter (finger down ≠ finger still),
// so use a bigger deadband before committing positions.
const TOUCH_MOVE_THRESHOLD_PX = 12

// Build an `ElementSnapshot`-shaped object using `(x0, y0)` from the gesture start
// and the other fields from the current state (those fields don't change during a
// body drag — only position).
function snapshotFromStart(s: DragElementState, sp: { x0: number, y0: number }) {
  return {
    x0: sp.x0,
    y0: sp.y0,
    width: s.width.value,
    height: s.height.value,
    rotate: s.rotate.value,
    zIndex: s.zIndex.value,
    cropTop: s.cropTop.value,
    cropRight: s.cropRight.value,
    cropBottom: s.cropBottom.value,
    cropLeft: s.cropLeft.value,
  }
}

function captureCurrent(s: DragElementState) {
  return {
    x0: s.x0.value,
    y0: s.y0.value,
    width: s.width.value,
    height: s.height.value,
    rotate: s.rotate.value,
    zIndex: s.zIndex.value,
    cropTop: s.cropTop.value,
    cropRight: s.cropRight.value,
    cropBottom: s.cropBottom.value,
    cropLeft: s.cropLeft.value,
  }
}

export interface BodyDragHandlerOptions {
  state: DragElementState
  // If true, the pointerdown is a no-op (e.g. iframe-interact mode for embeds).
  // Returning false means "proceed with the drag".
  shouldSkip?: () => boolean
}

export function handleBodyDragPointerdown(ev: PointerEvent, opts: BodyDragHandlerOptions): void {
  const { state } = opts
  if (ev.button !== 0)
    return
  if (opts.shouldSkip?.())
    return
  // Pinch-zoom in progress, or a second touch is already down: don't start a drag —
  // bail before stopPropagation so the pinch composable on a parent layer still sees
  // the event.
  if (isPinchOrPan.value)
    return
  if (ev.pointerType === 'touch' && activeTouchCount.value > 1)
    return

  ev.preventDefault()
  ev.stopPropagation()
  // The image consumer (`<img v-drag>`) sits on top of an anchor that has its own
  // pointer / click listeners; stop those from firing too.
  ev.stopImmediatePropagation?.()

  // Shift-click toggles selection without starting a drag.
  if (ev.shiftKey) {
    if (isSelected(state))
      removeFromSelection(state)
    else
      addToSelection(state)
    return
  }

  // `startDragging()` calls `selectElement(state)` which REPLACES the selection. If
  // this element was already part of a multi-selection, replacing would drop the
  // other members of the group before we have a chance to read `getSelectedElements`
  // for the drag plan — so only call `startDragging()` for fresh selections.
  const wasAlreadySelected = isSelected(state)
  if (!wasAlreadySelected)
    state.startDragging()

  const startX = ev.clientX
  const startY = ev.clientY
  const pointerType = ev.pointerType
  const pointerId = ev.pointerId
  const threshold = pointerType === 'touch' ? TOUCH_MOVE_THRESHOLD_PX : MOUSE_MOVE_THRESHOLD_PX

  // Snapshot the start positions of every selected element so we can compute the
  // delta against the original positions throughout the drag (not against the
  // previous frame's positions, which would accumulate float error).
  const selectedElements = Array.from(getSelectedElements())
  const startPositions = selectedElements.map(s => ({
    state: s,
    x0: s.x0.value,
    y0: s.y0.value,
  }))

  let committed = false
  let aborted = false

  function commit() {
    committed = true
  }

  function abort() {
    if (aborted)
      return
    aborted = true
    // Revert positions on the live state so the abort is visually invisible. We do
    // this only if we already committed (= moved past the jitter threshold), because
    // before that no positions have been mutated.
    if (committed) {
      for (const { state: s, x0, y0 } of startPositions) {
        s.x0.value = x0
        s.y0.value = y0
      }
    }
    state.clearSnapLines()
    document.removeEventListener('pointermove', handlePointermove)
    document.removeEventListener('pointerup', handlePointerup)
    document.removeEventListener('pointercancel', handlePointercancel)
  }

  function flushEdit() {
    if (!committed || aborted)
      return
    const slideNo = state.page.value
    if (selectedElements.length === 1) {
      void pushEdit(
        slideNo,
        'move',
        state.dragId,
        snapshotFromStart(state, startPositions[0]),
        captureCurrent(state),
      )
    }
    else {
      // Group move: one event covering every element's before/after. Atomicity matters
      // for undo — a single Cmd+Z should rewind the whole group, not one element.
      void pushGroupEdit(
        slideNo,
        'move',
        selectedElements.map((s) => {
          const sp = startPositions.find(p => p.state === s)!
          return {
            dragId: s.dragId,
            before: snapshotFromStart(s, sp),
            after: captureCurrent(s),
          }
        }),
      )
    }
  }

  function handlePointermove(moveEv: PointerEvent) {
    if (aborted || moveEv.pointerId !== pointerId)
      return
    // Pinch detected mid-drag: revert and bail.
    if (isPinchOrPan.value || (pointerType === 'touch' && activeTouchCount.value > 1)) {
      abort()
      return
    }

    const dxPx = moveEv.clientX - startX
    const dyPx = moveEv.clientY - startY

    if (!committed && Math.hypot(dxPx, dyPx) < threshold)
      return

    moveEv.preventDefault()
    commit()

    // Convert viewport-pixel delta to slide coords. `state.scale` is the combined
    // on-screen scale (slide-fit times any per-deck zoom).
    const scale = state.scale.value || 1
    const dx = dxPx / scale
    const dy = dyPx / scale

    // ⌘ (metaKey) disables snap-to-guides. Shift is reserved for "constrain" (AR
    // lock during resize, 15° rotation increments) so we don't overload it.
    const disableSnap = moveEv.metaKey

    if (selectedElements.length === 1) {
      const rawX = startPositions[0].x0 + dx
      const rawY = startPositions[0].y0 + dy
      const snapped = state.applySnap(rawX, rawY, disableSnap)
      state.x0.value = snapped.x
      state.y0.value = snapped.y
    }
    else {
      // Multi-select: snap is computed against the dragged element's would-be position,
      // and the resulting offset is applied to every member of the group. This keeps
      // the group's relative layout intact while letting the dragged element honour
      // alignment guides from other on-slide objects.
      const clickedStart = startPositions.find(p => p.state === state)!
      const rawX = clickedStart.x0 + dx
      const rawY = clickedStart.y0 + dy
      const snapped = state.applySnap(rawX, rawY, disableSnap)
      const snapDx = snapped.x - rawX
      const snapDy = snapped.y - rawY

      for (const { state: s, x0, y0 } of startPositions) {
        s.x0.value = x0 + dx + snapDx
        s.y0.value = y0 + dy + snapDy
      }
    }
  }

  function handlePointerup(upEv: PointerEvent) {
    if (upEv.pointerId !== pointerId)
      return
    flushEdit()
    state.clearSnapLines()
    document.removeEventListener('pointermove', handlePointermove)
    document.removeEventListener('pointerup', handlePointerup)
    document.removeEventListener('pointercancel', handlePointercancel)
  }

  function handlePointercancel(cancelEv: PointerEvent) {
    if (cancelEv.pointerId !== pointerId)
      return
    abort()
  }

  document.addEventListener('pointermove', handlePointermove)
  document.addEventListener('pointerup', handlePointerup)
  document.addEventListener('pointercancel', handlePointercancel)
}
