import { ref } from 'vue'

// Module-level count of active touch pointers, maintained by document-level
// listeners installed once per page. v-drag handlers consult this to bail out
// when a second finger lands (i.e. user is pinching), even in contexts where
// `usePinchZoomPan` isn't mounted (presenter mode, embeds).

const activeTouchIds = new Set<number>()
export const activeTouchCount = ref(0)

function refresh() {
  activeTouchCount.value = activeTouchIds.size
}

function onPointerDown(e: PointerEvent) {
  if (e.pointerType !== 'touch')
    return
  activeTouchIds.add(e.pointerId)
  refresh()
}

function onPointerEnd(e: PointerEvent) {
  if (e.pointerType !== 'touch')
    return
  if (activeTouchIds.delete(e.pointerId))
    refresh()
}

if (typeof document !== 'undefined') {
  // Capture phase so we count touches before any handler can stop propagation.
  document.addEventListener('pointerdown', onPointerDown, { capture: true })
  document.addEventListener('pointerup', onPointerEnd, { capture: true })
  document.addEventListener('pointercancel', onPointerEnd, { capture: true })
}
