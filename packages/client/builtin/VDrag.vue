<script setup lang="ts">
import type { DragElementMarkdownSource } from '../composables/useDragElements'
import { onMounted, onUnmounted, watchEffect } from 'vue'
import { useDragElement } from '../composables/useDragElements'
import { addToSelection, isSelected, removeFromSelection } from '../composables/useMultiSelect'

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
// `movedSlideDelta` tracks how far (in slide coords) we've moved total — we use this to
// distinguish "this was a click" (no movement) from "this was a drag" (some movement);
// a tiny jitter threshold keeps accidental 1-2px wiggles from spamming the history stack.
const MOVE_THRESHOLD_PX = 3
let drag: {
  pointerId: number
  startClientX: number
  startClientY: number
  startX0: number
  startY0: number
  snapshotSaved: boolean
} | null = null

function handlePointerdown(ev: PointerEvent) {
  if (ev.button !== 0)
    return
  // In interact mode (double-click to enter), let iframe clicks through.
  if (isInteracting.value)
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

  // Begin a body-drag. We don't call saveSnapshot() yet — defer until we actually move
  // past MOVE_THRESHOLD_PX so a pure click (select-only) doesn't pollute undo history.
  drag = {
    pointerId: ev.pointerId,
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

  const dxPx = ev.clientX - drag.startClientX
  const dyPx = ev.clientY - drag.startClientY

  // Suppress until we cross the jitter threshold in VIEWPORT pixels (so the threshold
  // feels consistent regardless of the slide scale).
  if (!drag.snapshotSaved && Math.hypot(dxPx, dyPx) < MOVE_THRESHOLD_PX)
    return

  ev.preventDefault()
  ev.stopPropagation()

  if (!drag.snapshotSaved) {
    state.saveSnapshot()
    drag.snapshotSaved = true
  }

  // Convert viewport-pixel delta to slide coords.
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
  state.clearSnapLines()
  drag = null
}

function handlePointercancel(ev: PointerEvent) {
  if (!drag || ev.pointerId !== drag.pointerId)
    return
  // Revert on cancel if we already saved a snapshot.
  if (drag.snapshotSaved)
    state.undo()
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
