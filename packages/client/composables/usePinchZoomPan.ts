import type { Ref } from 'vue'
import { onUnmounted, ref, watch, watchEffect } from 'vue'
import { useNav } from './useNav'

const { min, max, hypot, exp } = Math

const MAX_ZOOM = 8
const MIN_ZOOM = 1
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_DIST = 30

function clamp(v: number, lo: number, hi: number) {
  return min(hi, max(lo, v))
}

interface PinchState {
  dist: number
  cx: number
  cy: number
  zoom0: number
  panX0: number
  panY0: number
  centerX: number
  centerY: number
}

interface PanState {
  startX: number
  startY: number
  panX0: number
  panY0: number
  moved: boolean
}

interface Tap {
  t: number
  x: number
  y: number
}

// Shared so other composables (e.g. useSwipeControls) can suppress their handling
// when a pinch/pan is in progress.
export const isPinchOrPan = ref(false)

export function usePinchZoomPan(container: Ref<HTMLElement | undefined | null>) {
  const { currentSlideNo } = useNav()

  const zoom = ref(1)
  const panX = ref(0)
  const panY = ref(0)

  let pinch: PinchState | null = null
  let pan: PanState | null = null
  let lastTap: Tap | null = null

  function reset() {
    zoom.value = 1
    panX.value = 0
    panY.value = 0
  }

  watch(currentSlideNo, () => reset())

  function getRect() {
    return container.value?.getBoundingClientRect()
  }

  function clampPan() {
    const rect = getRect()
    if (!rect)
      return
    // Slide content matches the container size at zoom=1 (it's scaled to fit).
    // When userZoom > 1, allow panning by half the overflow on each axis.
    const overflowX = rect.width * (zoom.value - 1) / 2
    const overflowY = rect.height * (zoom.value - 1) / 2
    panX.value = clamp(panX.value, -overflowX, overflowX)
    panY.value = clamp(panY.value, -overflowY, overflowY)
  }

  // Update zoom around a screen-space point (cx, cy), keeping it stable.
  function zoomAround(newZoom: number, cx: number, cy: number) {
    const rect = getRect()
    if (!rect)
      return
    const z0 = zoom.value
    const z1 = clamp(newZoom, MIN_ZOOM, MAX_ZOOM)
    if (z1 === z0)
      return
    const ratio = z1 / z0
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    // Offset of pinch point from container center (in screen px), accounting for current pan.
    const dx = cx - centerX - panX.value
    const dy = cy - centerY - panY.value
    panX.value = panX.value - (ratio - 1) * dx
    panY.value = panY.value - (ratio - 1) * dy
    zoom.value = z1
    clampPan()
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length >= 2) {
      // Pinch start
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const rect = getRect()
      if (!rect)
        return
      pinch = {
        dist: hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY) || 1,
        cx: (t1.clientX + t2.clientX) / 2,
        cy: (t1.clientY + t2.clientY) / 2,
        zoom0: zoom.value,
        panX0: panX.value,
        panY0: panY.value,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      }
      pan = null
      isPinchOrPan.value = true
      e.preventDefault()
    }
    else if (e.touches.length === 1 && zoom.value > 1) {
      const t = e.touches[0]
      pan = {
        startX: t.clientX,
        startY: t.clientY,
        panX0: panX.value,
        panY0: panY.value,
        moved: false,
      }
      isPinchOrPan.value = true
      // Don't preventDefault yet — if it turns out to be just a tap, we want a
      // possible double-tap-to-reset to fire. Set the flag in touchmove instead.
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (pinch && e.touches.length >= 2) {
      e.preventDefault()
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY) || 1
      const cx = (t1.clientX + t2.clientX) / 2
      const cy = (t1.clientY + t2.clientY) / 2
      const newZoom = clamp(pinch.zoom0 * (dist / pinch.dist), MIN_ZOOM, MAX_ZOOM)
      const ratio = newZoom / pinch.zoom0
      // Pinch-stable around the original centroid, plus follow centroid drift (2-finger pan).
      const dx0 = pinch.cx - pinch.centerX - pinch.panX0
      const dy0 = pinch.cy - pinch.centerY - pinch.panY0
      panX.value = pinch.panX0 - (ratio - 1) * dx0 + (cx - pinch.cx)
      panY.value = pinch.panY0 - (ratio - 1) * dy0 + (cy - pinch.cy)
      zoom.value = newZoom
      clampPan()
    }
    else if (pan && e.touches.length === 1) {
      const t = e.touches[0]
      const dx = t.clientX - pan.startX
      const dy = t.clientY - pan.startY
      if (!pan.moved && hypot(dx, dy) < DOUBLE_TAP_DIST) {
        // Still within tap-jitter range — leave the page free to dispatch click etc.
        return
      }
      pan.moved = true
      e.preventDefault()
      panX.value = pan.panX0 + dx
      panY.value = pan.panY0 + dy
      clampPan()
    }
  }

  function onTouchEnd(e: TouchEvent) {
    // If we drop from 2 to 1 finger, end pinch and start a fresh single-finger pan
    // so the remaining finger can keep dragging without a jump.
    if (pinch && e.touches.length < 2) {
      pinch = null
      if (e.touches.length === 1 && zoom.value > 1) {
        const t = e.touches[0]
        pan = {
          startX: t.clientX,
          startY: t.clientY,
          panX0: panX.value,
          panY0: panY.value,
          moved: false,
        }
        return
      }
    }
    if (e.touches.length === 0) {
      // Treat a no-move single-finger touch as a tap (eligible for double-tap).
      // Pinches and moved pans are gestures, not taps.
      const wasTap = !pinch && (!pan || !pan.moved)
      const t = e.changedTouches[0]
      if (wasTap && t) {
        const now = Date.now()
        if (lastTap && now - lastTap.t < DOUBLE_TAP_MS
          && hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < DOUBLE_TAP_DIST) {
          if (zoom.value > 1)
            reset()
          else
            zoomAround(2, t.clientX, t.clientY)
          lastTap = null
        }
        else {
          lastTap = { t: now, x: t.clientX, y: t.clientY }
        }
      }
      pan = null
      pinch = null
      isPinchOrPan.value = false
    }
  }

  function onTouchCancel() {
    pan = null
    pinch = null
    isPinchOrPan.value = false
  }

  // Trackpad pinch on macOS arrives as wheel events with ctrlKey=true (regardless of
  // whether the user is holding Ctrl — that's the gesture's signature). Mouse-wheel
  // zoom (Ctrl+scroll) hits the same path, which is intentional.
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey)
      return
    e.preventDefault()
    const factor = exp(-e.deltaY * 0.01)
    zoomAround(zoom.value * factor, e.clientX, e.clientY)
  }

  // Use { passive: false } so preventDefault() actually blocks the browser's
  // native scroll/zoom on the slide container.
  const opts = { passive: false } as AddEventListenerOptions

  watch(container, (el, _old, onCleanup) => {
    if (!el)
      return
    el.addEventListener('touchstart', onTouchStart, opts)
    el.addEventListener('touchmove', onTouchMove, opts)
    el.addEventListener('touchend', onTouchEnd, opts)
    el.addEventListener('touchcancel', onTouchCancel, opts)
    el.addEventListener('wheel', onWheel, opts)
    onCleanup(() => {
      el.removeEventListener('touchstart', onTouchStart, opts)
      el.removeEventListener('touchmove', onTouchMove, opts)
      el.removeEventListener('touchend', onTouchEnd, opts)
      el.removeEventListener('touchcancel', onTouchCancel, opts)
      el.removeEventListener('wheel', onWheel, opts)
    })
  }, { immediate: true })

  // Drive the CSS vars consumed by .slidev-slide-content. SlideContainer.vue
  // already sets --slidev-slide-scale globally; we follow the same convention.
  if (typeof document !== 'undefined') {
    const rootStyle = document.documentElement.style
    watchEffect(() => {
      rootStyle.setProperty('--slidev-user-zoom', String(zoom.value))
      rootStyle.setProperty('--slidev-pan-x', `${panX.value}px`)
      rootStyle.setProperty('--slidev-pan-y', `${panY.value}px`)
    })
    onUnmounted(() => {
      rootStyle.removeProperty('--slidev-user-zoom')
      rootStyle.removeProperty('--slidev-pan-x')
      rootStyle.removeProperty('--slidev-pan-y')
    })
  }

  onUnmounted(() => {
    isPinchOrPan.value = false
  })

  return {
    zoom,
    panX,
    panY,
    reset,
  }
}
