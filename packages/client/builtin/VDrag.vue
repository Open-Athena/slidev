<script setup lang="ts">
import type { DragElementMarkdownSource } from '../composables/useDragElements'
import { onMounted, onUnmounted, watchEffect } from 'vue'
import { activeTouchCount } from '../composables/useActiveTouches'
import { useDragElement } from '../composables/useDragElements'
import { addToSelection, isSelected, removeFromSelection } from '../composables/useMultiSelect'
import { isPinchOrPan } from '../composables/usePinchZoomPan'

const props = defineProps<{
  pos?: string
  markdownSource?: DragElementMarkdownSource
  // Lock the wrapper's aspect ratio (width / height) to this value. Used by Youtube /
  // Tweet wrappers around fixed-AR content. Falsy = free resize.
  lockAspectRatio?: number
}>()

const state = useDragElement(null, props.pos, props.markdownSource)
const { dragId, container, containerStyle, mounted, unmounted, startDragging, enabled, isInteracting, x0, y0, scale } = state

watchEffect(() => {
  state.lockAspectRatio.value = props.lockAspectRatio || null
})

// Body-drag-to-move state. Null when no drag is in progress.
// We defer `saveSnapshot()` (and any position writes) until the pointer moves past a
// jitter threshold, so a pure click (select-only) doesn't pollute undo history. The
// threshold is bigger for touch because finger-down jitter is much larger than mouse.
const MOUSE_MOVE_THRESHOLD_PX = 3
const TOUCH_MOVE_THRESHOLD_PX = 12
let drag: {
  pointerId: number
  pointerType: string
  startClientX: number
  startClientY: number
  startX0: number
  startY0: number
  snapshotSaved: boolean
} | null = null

function abortDrag(target: HTMLElement | null) {
  if (!drag)
    return
  // Revert if we already committed (past the jitter threshold).
  if (drag.snapshotSaved)
    state.discardSnapshot()
  target?.releasePointerCapture?.(drag.pointerId)
  state.clearSnapLines()
  drag = null
}

function handlePointerdown(ev: PointerEvent) {
  if (ev.button !== 0)
    return
  // In interact mode (double-click to enter), let iframe clicks through.
  if (isInteracting.value)
    return
  // Pinch-zoom in progress, or a second touch is already down: don't start a body drag.
  if (isPinchOrPan.value)
    return
  if (ev.pointerType === 'touch' && activeTouchCount.value > 1)
    return

  ev.preventDefault()
  ev.stopPropagation()

  // Shift-click: toggle multi-select without starting a drag.
  if (ev.shiftKey) {
    if (isSelected(state))
      removeFromSelection(state)
    else
      addToSelection(state)
    return
  }

  startDragging()

  drag = {
    pointerId: ev.pointerId,
    pointerType: ev.pointerType,
    startClientX: ev.clientX,
    startClientY: ev.clientY,
    startX0: x0.value,
    startY0: y0.value,
    snapshotSaved: false,
  }
  // Capture so pointermove/up continue firing even when the cursor leaves this element
  // (e.g. drifts onto the iframe inside, or off the wrapper entirely).
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
}

function handlePointermove(ev: PointerEvent) {
  if (!drag || ev.pointerId !== drag.pointerId || ev.buttons !== 1)
    return

  // A pinch started (two fingers down, or pinch composable raised the flag): abort.
  if (isPinchOrPan.value || (drag.pointerType === 'touch' && activeTouchCount.value > 1)) {
    abortDrag(ev.currentTarget as HTMLElement)
    return
  }

  const dxPx = ev.clientX - drag.startClientX
  const dyPx = ev.clientY - drag.startClientY

  const threshold = drag.pointerType === 'touch' ? TOUCH_MOVE_THRESHOLD_PX : MOUSE_MOVE_THRESHOLD_PX
  if (!drag.snapshotSaved && Math.hypot(dxPx, dyPx) < threshold)
    return

  ev.preventDefault()
  ev.stopPropagation()

  if (!drag.snapshotSaved) {
    state.saveSnapshot()
    drag.snapshotSaved = true
  }

  const s = scale.value || 1
  const rawX = drag.startX0 + dxPx / s
  const rawY = drag.startY0 + dyPx / s

  // Apply snap. Hold Shift or Cmd (metaKey) to disable snap.
  const snapped = state.applySnap(rawX, rawY, ev.shiftKey || ev.metaKey)
  x0.value = snapped.x
  y0.value = snapped.y
}

function handlePointerup(ev: PointerEvent) {
  if (!drag || ev.pointerId !== drag.pointerId)
    return
  const target = ev.currentTarget as HTMLElement
  target.releasePointerCapture?.(ev.pointerId)
  // Force-commit any pending edit so the recorded `after` reflects the final pointer
  // position rather than waiting on the watcher's debounce (which would race with the
  // next interaction).
  if (drag.snapshotSaved)
    void state.commitSnapshot()
  state.clearSnapLines()
  drag = null
}

function handlePointercancel(ev: PointerEvent) {
  if (!drag || ev.pointerId !== drag.pointerId)
    return
  // Revert on cancel if we already committed.
  if (drag.snapshotSaved)
    state.discardSnapshot()
  drag = null
  state.clearSnapLines()
}

function handleDblclick(ev: MouseEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  if (container.value?.querySelector('iframe'))
    state.enterInteractMode()
  else
    state.enterCropMode()
}

onMounted(mounted)
onUnmounted(unmounted)
</script>

<template>
  <div
    ref="container"
    :data-drag-id="dragId"
    :data-drag-editing="enabled ? '' : undefined"
    :data-drag-interact="isInteracting ? '' : undefined"
    :style="containerStyle"
    class="p-1"
    @pointerdown="handlePointerdown"
    @pointermove="handlePointermove"
    @pointerup="handlePointerup"
    @pointercancel="handlePointercancel"
    @click.prevent.stop
    @dblclick.prevent.stop="handleDblclick"
  >
    <slot />
  </div>
</template>
