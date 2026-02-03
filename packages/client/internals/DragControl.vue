<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- Computed setters intentionally wrap parent refs for two-way binding */
import type { Pausable } from '@vueuse/core'
import type { DragElementState } from '../composables/useDragElements'
import { clamp } from '@antfu/utils'
import { useIntervalFn } from '@vueuse/core'
import { computed, inject, ref, watchEffect } from 'vue'
import { useSlideBounds } from '../composables/useSlideBounds'
import { injectionSlideScale } from '../constants'
import { slideHeight, slideWidth } from '../env'
import { magicKeys } from '../state'

const props = defineProps<{ data: DragElementState }>()

// Use computed to ensure we always access the current data prop's values
const dragId = computed(() => props.data.dragId)
const zoom = computed(() => props.data.zoom.value)
const autoHeight = computed(() => props.data.autoHeight)
const x0 = computed({
  get: () => props.data.x0.value,
  set: (v: number) => props.data.x0.value = v,
})
const y0 = computed({
  get: () => props.data.y0.value,
  set: (v: number) => props.data.y0.value = v,
})
const width = computed({
  get: () => props.data.width.value,
  set: (v: number) => props.data.width.value = v,
})
const height = computed({
  get: () => props.data.height.value,
  set: (v: number) => props.data.height.value = v,
})
const rotate = computed({
  get: () => props.data.rotate.value,
  set: (v: number) => props.data.rotate.value = v,
})
const zIndex = computed({
  get: () => props.data.zIndex.value,
  set: (v: number) => props.data.zIndex.value = v,
})
const isArrow = computed(() => props.data.isArrow)

// Crop mode state
const isCropping = computed(() => props.data.isCropping.value)
const cropTop = computed({
  get: () => props.data.cropTop.value,
  set: (v: number) => props.data.cropTop.value = v,
})
const cropRight = computed({
  get: () => props.data.cropRight.value,
  set: (v: number) => props.data.cropRight.value = v,
})
const cropBottom = computed({
  get: () => props.data.cropBottom.value,
  set: (v: number) => props.data.cropBottom.value = v,
})
const cropLeft = computed({
  get: () => props.data.cropLeft.value,
  set: (v: number) => props.data.cropLeft.value = v,
})

// Store initial aspect ratio for reset - captured once when component mounts
// Note: For images, ideally this would use natural dimensions, but we use initial dimensions
const initialAspectRatio = width.value / height.value

// Check if there's any crop applied
const hasCrop = computed(() => cropTop.value > 0 || cropRight.value > 0 || cropBottom.value > 0 || cropLeft.value > 0)

// Full dimensions (always the original size)
const fullWidth = computed(() => Math.abs(width.value))
const fullHeight = computed(() => Math.abs(height.value))

// Cropped dimensions (the visible portion)
const croppedWidth = computed(() => fullWidth.value * (100 - cropLeft.value - cropRight.value) / 100)
const croppedHeight = computed(() => fullHeight.value * (100 - cropTop.value - cropBottom.value) / 100)

// Crop offset in LOCAL element coordinates (before rotation)
const cropOffsetLocalX = computed(() => (cropLeft.value - cropRight.value) / 100 * fullWidth.value / 2)
const cropOffsetLocalY = computed(() => (cropTop.value - cropBottom.value) / 100 * fullHeight.value / 2)

// Detect if the element has an associated link (wrapping <a> or internal <a>)
const associatedLink = computed(() => {
  const el = props.data.container.value
  if (!el)
    return null

  // Check if element itself is an anchor
  if (el.tagName === 'A')
    return (el as HTMLAnchorElement).href

  // Check if element is wrapped by an anchor
  const parentAnchor = el.closest('a')
  if (parentAnchor)
    return parentAnchor.href

  // Check if element contains an anchor (e.g., image inside a link)
  const childAnchor = el.querySelector('a')
  if (childAnchor)
    return childAnchor.href

  return null
})

// Get image source from the dragged element (for rendering in crop mode)
const imageSrc = computed(() => {
  const el = props.data.container.value
  if (!el)
    return null

  // Check if element itself is an image
  if (el.tagName === 'IMG')
    return (el as HTMLImageElement).src

  // Check for img inside the element
  const img = el.querySelector('img')
  if (img)
    return img.src

  // Check for background-image style
  const bgImage = window.getComputedStyle(el).backgroundImage
  if (bgImage && bgImage !== 'none') {
    const match = bgImage.match(/url\(["']?(.+?)["']?\)/)
    if (match)
      return match[1]
  }

  return null
})

const slideScale = inject(injectionSlideScale, ref(1))
const scale = computed(() => slideScale.value * zoom.value)
const { left: slideLeft, top: slideTop } = useSlideBounds()

const ctrlSize = 10
const minSize = computed(() => isArrow.value ? Number.NEGATIVE_INFINITY : 40)
const minRemain = 10

const rotateRad = computed(() => rotate.value * Math.PI / 180)
const rotateSin = computed(() => Math.sin(rotateRad.value))
const rotateCos = computed(() => Math.cos(rotateRad.value))

// Visible center in WORLD coordinates (crop offset rotated by element rotation)
const visibleCenterX = computed(() => x0.value + cropOffsetLocalX.value * rotateCos.value - cropOffsetLocalY.value * rotateSin.value)
const visibleCenterY = computed(() => y0.value + cropOffsetLocalX.value * rotateSin.value + cropOffsetLocalY.value * rotateCos.value)

// Display dimensions: full size in crop mode, cropped size otherwise
const displayWidth = computed(() => isCropping.value ? fullWidth.value : (hasCrop.value ? croppedWidth.value : fullWidth.value))
const displayHeight = computed(() => isCropping.value ? fullHeight.value : (hasCrop.value ? croppedHeight.value : fullHeight.value))
// Selection box should be at visible center (for cropped images) or element center
const displayX0 = computed(() => isCropping.value ? x0.value : (hasCrop.value ? visibleCenterX.value : x0.value))
const displayY0 = computed(() => isCropping.value ? y0.value : (hasCrop.value ? visibleCenterY.value : y0.value))

const boundingWidth = computed(() => Math.abs(width.value * rotateCos.value) + Math.abs(height.value * rotateSin.value))
const boundingHeight = computed(() => Math.abs(width.value * rotateSin.value) + Math.abs(height.value * rotateCos.value))

const boundingLeft = computed(() => x0.value - boundingWidth.value / 2)
const boundingTop = computed(() => y0.value - boundingHeight.value / 2)
const boundingRight = computed(() => x0.value + boundingWidth.value / 2)
const boundingBottom = computed(() => y0.value + boundingHeight.value / 2)

const arrowRevX = computed(() => isArrow.value && width.value < 0)
const arrowRevY = computed(() => isArrow.value && height.value < 0)

// Rotation state
const isRotating = ref(false)
const rotationStartAngle = ref(0) // Original element rotation when started (for ghost preview)
const rotationStartMouseAngle = ref(0) // Mouse angle from center when rotation started
const currentRotationAngle = ref(0) // Live angle during rotation (for display)
// Store the visible center position at rotation start (to keep it fixed during rotation)
const rotationPivotX = ref(0)
const rotationPivotY = ref(0)

let currentDrag: {
  x0: number
  y0: number
  width: number
  height: number
  rotate: number
  dx0: number
  dy0: number
  ltx: number
  lty: number
  rtx: number
  rty: number
  lbx: number
  lby: number
  rbx: number
  rby: number
} | null = null

function onPointerdown(ev: PointerEvent) {
  if (ev.buttons !== 1)
    return

  ev.preventDefault()
  ev.stopPropagation()
  const el = ev.target as HTMLElement
  const elBounds = el.getBoundingClientRect()

  const cross1x = width.value * rotateCos.value - height.value * rotateSin.value
  const cross1y = width.value * rotateSin.value + height.value * rotateCos.value
  const cross2x = width.value * rotateCos.value + height.value * rotateSin.value
  const cross2y = -width.value * rotateSin.value + height.value * rotateCos.value

  currentDrag = {
    x0: x0.value,
    y0: y0.value,
    width: width.value,
    height: height.value,
    rotate: rotate.value,
    dx0: ev.clientX - (elBounds.left + elBounds.right) / 2,
    dy0: ev.clientY - (elBounds.top + elBounds.bottom) / 2,
    ltx: x0.value - cross1x / 2,
    lty: y0.value - cross1y / 2,
    rtx: x0.value + cross2x / 2,
    rty: y0.value - cross2y / 2,
    lbx: x0.value - cross2x / 2,
    lby: y0.value + cross2y / 2,
    rbx: x0.value + cross1x / 2,
    rby: y0.value + cross1y / 2,
  };

  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
}

function _onPointermove(ev: PointerEvent) {
  if (!currentDrag || ev.buttons !== 1)
    return

  ev.preventDefault()
  ev.stopPropagation()

  const x = (ev.clientX - slideLeft.value - currentDrag.dx0) / scale.value
  const y = (ev.clientY - slideTop.value - currentDrag.dy0) / scale.value

  x0.value = clamp(x, -boundingWidth.value / 2 + minRemain, slideWidth.value + boundingWidth.value / 2 - minRemain)
  y0.value = clamp(y, -boundingHeight.value / 2 + minRemain, slideHeight.value + boundingHeight.value / 2 - minRemain)
}

function onPointerup(ev: PointerEvent) {
  if (!currentDrag)
    return

  ev.preventDefault()
  ev.stopPropagation()

  currentDrag = null
}

const ctrlClasses = `absolute border border-gray bg-gray dark:border-gray-500 dark:bg-gray-800 bg-opacity-30 `

function getCornerProps(isLeft: boolean, isTop: boolean) {
  return {
    onPointerdown,
    onPointermove: (ev: PointerEvent) => {
      if (!currentDrag || ev.buttons !== 1)
        return

      ev.preventDefault()
      ev.stopPropagation()

      let x = (ev.clientX - slideLeft.value) / scale.value
      let y = (ev.clientY - slideTop.value) / scale.value

      const { ltx, lty, rtx, rty, lbx, lby, rbx, rby } = currentDrag

      const ratio = currentDrag.width / currentDrag.height
      const wMin = Math.max(minSize.value, minSize.value * ratio)
      function getSize(w1: number, h1: number) {
        if (ev.shiftKey) {
          const w = Math.max(w1, h1 * ratio, wMin)
          const h = w / ratio
          return { w, h }
        }
        else {
          return { w: Math.max(w1, minSize.value), h: Math.max(h1, minSize.value) }
        }
      }

      if (isLeft) {
        if (isTop) {
          const w1 = (rbx - x) * rotateCos.value + (rby - y) * rotateSin.value
          const h1 = -(rbx - x) * rotateSin.value + (rby - y) * rotateCos.value
          const { w, h } = getSize(w1, h1)
          x = rbx - w * rotateCos.value + h * rotateSin.value
          y = rby - w * rotateSin.value - h * rotateCos.value
        }
        else {
          const w1 = (rtx - x) * rotateCos.value - (y - rty) * rotateSin.value
          const h1 = (rtx - x) * rotateSin.value + (y - rty) * rotateCos.value
          const { w, h } = getSize(w1, h1)
          x = rtx - w * rotateCos.value - h * rotateSin.value
          y = rty - w * rotateSin.value + h * rotateCos.value
        }
      }
      else {
        if (isTop) {
          const w1 = (x - lbx) * rotateCos.value - (lby - y) * rotateSin.value
          const h1 = (x - lbx) * rotateSin.value + (lby - y) * rotateCos.value
          const { w, h } = getSize(w1, h1)
          x = lbx + w * rotateCos.value + h * rotateSin.value
          y = lby + w * rotateSin.value - h * rotateCos.value
        }
        else {
          const w1 = (x - ltx) * rotateCos.value + (y - lty) * rotateSin.value
          const h1 = -(x - ltx) * rotateSin.value + (y - lty) * rotateCos.value
          const { w, h } = getSize(w1, h1)
          x = ltx + w * rotateCos.value - h * rotateSin.value
          y = lty + w * rotateSin.value + h * rotateCos.value
        }
      }

      if (isLeft) {
        if (isTop) {
          x0.value = (x + rbx) / 2
          y0.value = (y + rby) / 2
          width.value = (rbx - x) * rotateCos.value + (rby - y) * rotateSin.value
          height.value = -(rbx - x) * rotateSin.value + (rby - y) * rotateCos.value
        }
        else {
          x0.value = (x + rtx) / 2
          y0.value = (y + rty) / 2
          width.value = (rtx - x) * rotateCos.value - (y - rty) * rotateSin.value
          height.value = (rtx - x) * rotateSin.value + (y - rty) * rotateCos.value
        }
      }
      else {
        if (isTop) {
          x0.value = (x + lbx) / 2
          y0.value = (y + lby) / 2
          width.value = (x - lbx) * rotateCos.value - (lby - y) * rotateSin.value
          height.value = (x - lbx) * rotateSin.value + (lby - y) * rotateCos.value
        }
        else {
          x0.value = (x + ltx) / 2
          y0.value = (y + lty) / 2
          width.value = (x - ltx) * rotateCos.value + (y - lty) * rotateSin.value
          height.value = -(x - ltx) * rotateSin.value + (y - lty) * rotateCos.value
        }
      }
    },
    onPointerup,
    style: {
      width: `${ctrlSize}px`,
      height: `${ctrlSize}px`,
      margin: `-${ctrlSize / 2}px`,
      left: isLeft !== arrowRevX.value ? '0' : undefined,
      right: isLeft !== arrowRevX.value ? undefined : '0',
      top: isTop !== arrowRevY.value ? '0' : undefined,
      bottom: isTop !== arrowRevY.value ? undefined : '0',
      cursor: isArrow.value ? 'move' : +isLeft + +isTop === 1 ? 'nesw-resize' : 'nwse-resize',
      borderRadius: isArrow.value ? '50%' : undefined,
      pointerEvents: 'auto',
    },
    class: ctrlClasses,
  }
}

function getBorderProps(dir: 'l' | 'r' | 't' | 'b') {
  return {
    onPointerdown,
    onPointermove: (ev: PointerEvent) => {
      if (!currentDrag || ev.buttons !== 1)
        return

      ev.preventDefault()
      ev.stopPropagation()

      const x = (ev.clientX - slideLeft.value) / scale.value
      const y = (ev.clientY - slideTop.value) / scale.value

      const { ltx, lty, rtx, rty, lbx, lby, rbx, rby } = currentDrag

      if (dir === 'l') {
        const rx = (rtx + rbx) / 2
        const ry = (rty + rby) / 2
        width.value = Math.max((rx - x) * rotateCos.value + (ry - y) * rotateSin.value, minSize.value)
        x0.value = rx - width.value * rotateCos.value / 2
        y0.value = ry - width.value * rotateSin.value / 2
      }
      else if (dir === 'r') {
        const lx = (ltx + lbx) / 2
        const ly = (lty + lby) / 2
        width.value = Math.max((x - lx) * rotateCos.value + (y - ly) * rotateSin.value, minSize.value)
        x0.value = lx + width.value * rotateCos.value / 2
        y0.value = ly + width.value * rotateSin.value / 2
      }
      else if (dir === 't') {
        const bx = (lbx + rbx) / 2
        const by = (lby + rby) / 2
        height.value = Math.max((by - y) * rotateCos.value - (bx - x) * rotateSin.value, minSize.value)
        x0.value = bx + height.value * rotateSin.value / 2
        y0.value = by - height.value * rotateCos.value / 2
      }
      else if (dir === 'b') {
        const tx = (ltx + rtx) / 2
        const ty = (lty + rty) / 2
        height.value = Math.max((y - ty) * rotateCos.value - (x - tx) * rotateSin.value, minSize.value)
        x0.value = tx - height.value * rotateSin.value / 2
        y0.value = ty + height.value * rotateCos.value / 2
      }
    },
    onPointerup,
    style: {
      width: `${ctrlSize}px`,
      height: `${ctrlSize}px`,
      margin: `-${ctrlSize / 2}px`,
      left: dir === 'l' ? '0' : dir === 'r' ? `100%` : `50%`,
      top: dir === 't' ? '0' : dir === 'b' ? `100%` : `50%`,
      cursor: 'lr'.includes(dir) ? 'ew-resize' : 'ns-resize',
      borderRadius: '50%',
      pointerEvents: 'auto',
    },
    class: ctrlClasses,
  }
}

const rotateHandleSize = 18
const rotateHandleOffset = 32 // Distance from top of element

// Helper to calculate angle from a pivot point to a mouse position (0° = up/12 o'clock)
function getAngleFromPivot(clientX: number, clientY: number, pivotX: number, pivotY: number): number {
  const mouseX = (clientX - slideLeft.value) / scale.value
  const mouseY = (clientY - slideTop.value) / scale.value
  return Math.atan2(mouseX - pivotX, -(mouseY - pivotY)) * 180 / Math.PI
}

function getRotateProps() {
  return {
    onPointerdown: (ev: PointerEvent) => {
      if (ev.buttons !== 1)
        return
      ev.preventDefault()
      ev.stopPropagation()

      // Store the visible center as the rotation pivot (stays fixed during rotation)
      rotationPivotX.value = hasCrop.value ? visibleCenterX.value : x0.value
      rotationPivotY.value = hasCrop.value ? visibleCenterY.value : y0.value

      // Store initial rotation for ghost preview
      rotationStartAngle.value = rotate.value
      currentRotationAngle.value = rotate.value
      // Store where the mouse started (angle from pivot) so we can calculate delta
      rotationStartMouseAngle.value = getAngleFromPivot(ev.clientX, ev.clientY, rotationPivotX.value, rotationPivotY.value)
      isRotating.value = true

      // We still need currentDrag for the general infrastructure
      currentDrag = {
        x0: x0.value,
        y0: y0.value,
        width: width.value,
        height: height.value,
        rotate: rotate.value,
        dx0: 0,
        dy0: 0,
        ltx: 0,
        lty: 0,
        rtx: 0,
        rty: 0,
        lbx: 0,
        lby: 0,
        rbx: 0,
        rby: 0,
      }

      ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
    },
    onPointermove: (ev: PointerEvent) => {
      if (!currentDrag || ev.buttons !== 1)
        return

      ev.preventDefault()
      ev.stopPropagation()

      // Calculate current mouse angle from the rotation pivot
      const currentMouseAngle = getAngleFromPivot(ev.clientX, ev.clientY, rotationPivotX.value, rotationPivotY.value)

      // Calculate delta from where we started dragging
      const delta = currentMouseAngle - rotationStartMouseAngle.value

      // New rotation = starting rotation + delta
      let angle = rotationStartAngle.value + delta

      // Normalize to 0-360
      angle = ((angle % 360) + 360) % 360

      // Snap to 15° increments only when holding Shift
      if (ev.shiftKey) {
        angle = Math.round(angle / 15) * 15
      }

      currentRotationAngle.value = angle
      rotate.value = angle

      // For cropped images, adjust x0/y0 to keep the visible center at the pivot
      if (hasCrop.value) {
        const newAngleRad = angle * Math.PI / 180
        const cos = Math.cos(newAngleRad)
        const sin = Math.sin(newAngleRad)
        // x0 = pivot - rotated offset
        x0.value = rotationPivotX.value - (cropOffsetLocalX.value * cos - cropOffsetLocalY.value * sin)
        y0.value = rotationPivotY.value - (cropOffsetLocalX.value * sin + cropOffsetLocalY.value * cos)
      }
    },
    onPointerup: (ev: PointerEvent) => {
      if (!currentDrag)
        return
      ev.preventDefault()
      ev.stopPropagation()
      isRotating.value = false
      currentDrag = null
    },
    style: {
      position: 'absolute' as const,
      width: `${rotateHandleSize}px`,
      height: `${rotateHandleSize}px`,
      left: '50%',
      marginLeft: `-${rotateHandleSize / 2}px`,
      top: `-${rotateHandleOffset}px`,
      cursor: 'grab',
      borderRadius: '50%',
      pointerEvents: 'auto',
      // Google Draw style: white fill with blue border
      background: '#fff',
      border: '2px solid #4285f4',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  }
}

const moveInterval = 20
const intervalFnOptions = {
  immediate: false,
  immediateCallback: false,
}
const moveLeft = useIntervalFn(() => {
  if (boundingRight.value <= minRemain)
    return
  x0.value--
}, moveInterval, intervalFnOptions)
const moveRight = useIntervalFn(() => {
  if (boundingLeft.value >= slideWidth.value - minRemain)
    return
  x0.value++
}, moveInterval, intervalFnOptions)
const moveUp = useIntervalFn(() => {
  if (boundingBottom.value <= minRemain)
    return
  y0.value--
}, moveInterval, intervalFnOptions)
const moveDown = useIntervalFn(() => {
  if (boundingTop.value >= slideHeight.value - minRemain)
    return
  y0.value++
}, moveInterval, intervalFnOptions)

watchEffect(() => {
  function shortcut(key: string, fn: Pausable) {
    if (magicKeys[key].value)
      fn.resume()
    else fn.pause()
  }
  shortcut('left', moveLeft)
  shortcut('right', moveRight)
  shortcut('up', moveUp)
  shortcut('down', moveDown)
})

function openLink() {
  if (associatedLink.value)
    window.open(associatedLink.value, '_blank')
}

function resetAspectRatio() {
  // Reset to initial aspect ratio, keeping width constant
  height.value = width.value / initialAspectRatio
}

function bringForward() {
  zIndex.value += 1
}

function sendBackward() {
  zIndex.value = Math.max(1, zIndex.value - 1)
}

function bringToFront() {
  zIndex.value = 1000
}

function sendToBack() {
  zIndex.value = 1
}

// Z-order keyboard shortcuts
watchEffect(() => {
  const meta = magicKeys.meta?.value || magicKeys.ctrl?.value
  const shift = magicKeys.shift?.value
  const up = magicKeys.ArrowUp?.value
  const down = magicKeys.ArrowDown?.value

  if (meta && up && !shift) {
    bringForward()
  }
  else if (meta && down && !shift) {
    sendBackward()
  }
  else if (meta && shift && up) {
    bringToFront()
  }
  else if (meta && shift && down) {
    sendToBack()
  }
})

// Enter key to exit crop mode
watchEffect(() => {
  if (isCropping.value && magicKeys.enter?.value) {
    props.data.exitCropMode()
  }
})

// Escape key to cancel crop mode (revert changes) or deselect
watchEffect(() => {
  if (magicKeys.escape?.value) {
    if (isCropping.value) {
      props.data.cancelCropMode()
    }
    else {
      props.data.stopDragging()
    }
  }
})

// Double-click to exit crop mode
function handleDblclick() {
  if (isCropping.value) {
    props.data.exitCropMode()
  }
}

// Crop handle dragging
const cornerHandleSize = 28 // L-shaped corner handles are larger
const edgeHandleLength = 20 // Length of edge midpoint handles
let currentCropDrag: {
  handle: 'top' | 'right' | 'bottom' | 'left' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  startCropTop: number
  startCropRight: number
  startCropBottom: number
  startCropLeft: number
  startX: number
  startY: number
} | null = null

function getCropHandleProps(handle: 'top' | 'right' | 'bottom' | 'left' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight') {
  const isCorner = handle.includes('top') || handle.includes('bottom') ? handle.includes('Left') || handle.includes('Right') : false
  const isVertical = handle === 'top' || handle === 'bottom'

  // Position calculations based on current crop values
  let left = '0'
  let top = '0'
  let cursorStyle = 'default'

  // Calculate crop region center for edge handle positioning
  const cropCenterX = cropLeft.value + (100 - cropLeft.value - cropRight.value) / 2
  const cropCenterY = cropTop.value + (100 - cropTop.value - cropBottom.value) / 2

  // Vertical position (top edge of handle)
  if (handle === 'top' || handle === 'topLeft' || handle === 'topRight') {
    top = `${cropTop.value}%`
  }
  else if (handle === 'bottom' || handle === 'bottomLeft' || handle === 'bottomRight') {
    top = `${100 - cropBottom.value}%`
  }
  else if (handle === 'left' || handle === 'right') {
    // Edge handles at vertical center of crop region
    top = `${cropCenterY}%`
  }

  // Horizontal position (left edge of handle)
  if (handle === 'left' || handle === 'topLeft' || handle === 'bottomLeft') {
    left = `${cropLeft.value}%`
  }
  else if (handle === 'right' || handle === 'topRight' || handle === 'bottomRight') {
    left = `${100 - cropRight.value}%`
  }
  else if (handle === 'top' || handle === 'bottom') {
    // Edge handles at horizontal center of crop region
    left = `${cropCenterX}%`
  }

  // Cursor styles
  if (handle === 'top' || handle === 'bottom') {
    cursorStyle = 'ns-resize'
  }
  else if (handle === 'left' || handle === 'right') {
    cursorStyle = 'ew-resize'
  }
  else if (handle === 'topLeft' || handle === 'bottomRight') {
    cursorStyle = 'nwse-resize'
  }
  else if (handle === 'topRight' || handle === 'bottomLeft') {
    cursorStyle = 'nesw-resize'
  }

  return {
    onPointerdown: (ev: PointerEvent) => {
      if (ev.buttons !== 1)
        return
      ev.preventDefault()
      ev.stopPropagation()

      currentCropDrag = {
        handle,
        startCropTop: cropTop.value,
        startCropRight: cropRight.value,
        startCropBottom: cropBottom.value,
        startCropLeft: cropLeft.value,
        startX: ev.clientX,
        startY: ev.clientY,
      }

      ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
    },
    onPointermove: (ev: PointerEvent) => {
      if (!currentCropDrag || ev.buttons !== 1)
        return
      ev.preventDefault()
      ev.stopPropagation()

      // Calculate delta as percentage of element size
      const dx = (ev.clientX - currentCropDrag.startX) / scale.value / width.value * 100
      const dy = (ev.clientY - currentCropDrag.startY) / scale.value / height.value * 100

      const h = currentCropDrag.handle

      // Update crop values based on which handle is being dragged
      if (h === 'top' || h === 'topLeft' || h === 'topRight') {
        cropTop.value = clamp(currentCropDrag.startCropTop + dy, 0, 100 - cropBottom.value - 10)
      }
      if (h === 'bottom' || h === 'bottomLeft' || h === 'bottomRight') {
        cropBottom.value = clamp(currentCropDrag.startCropBottom - dy, 0, 100 - cropTop.value - 10)
      }
      if (h === 'left' || h === 'topLeft' || h === 'bottomLeft') {
        cropLeft.value = clamp(currentCropDrag.startCropLeft + dx, 0, 100 - cropRight.value - 10)
      }
      if (h === 'right' || h === 'topRight' || h === 'bottomRight') {
        cropRight.value = clamp(currentCropDrag.startCropRight - dx, 0, 100 - cropLeft.value - 10)
      }
    },
    onPointerup: (ev: PointerEvent) => {
      if (!currentCropDrag)
        return
      ev.preventDefault()
      ev.stopPropagation()
      currentCropDrag = null
    },
    style: isCorner
      ? {
          // Corner handles: L-shaped brackets
          position: 'absolute' as const,
          left,
          top,
          width: `${cornerHandleSize}px`,
          height: `${cornerHandleSize}px`,
          // Position the L-bracket to wrap the corner
          marginLeft: handle === 'topLeft' || handle === 'bottomLeft' ? '-2px' : `-${cornerHandleSize - 2}px`,
          marginTop: handle === 'topLeft' || handle === 'topRight' ? '-2px' : `-${cornerHandleSize - 2}px`,
          background: 'transparent',
          // L-shape using thicker borders on two sides
          borderTop: (handle === 'topLeft' || handle === 'topRight') ? '5px solid #4285f4' : 'none',
          borderBottom: (handle === 'bottomLeft' || handle === 'bottomRight') ? '5px solid #4285f4' : 'none',
          borderLeft: (handle === 'topLeft' || handle === 'bottomLeft') ? '5px solid #4285f4' : 'none',
          borderRight: (handle === 'topRight' || handle === 'bottomRight') ? '5px solid #4285f4' : 'none',
          // Add white outline for visibility on dark backgrounds
          filter: 'drop-shadow(0 0 1px white) drop-shadow(0 0 1px white)',
          cursor: cursorStyle,
          pointerEvents: 'auto' as const,
          zIndex: 10,
        }
      : {
          // Edge handles: longer pill/oval shapes
          position: 'absolute' as const,
          left,
          top,
          width: isVertical ? `${edgeHandleLength}px` : '8px',
          height: isVertical ? '8px' : `${edgeHandleLength}px`,
          marginLeft: isVertical ? `-${edgeHandleLength / 2}px` : '-4px',
          marginTop: isVertical ? '-4px' : `-${edgeHandleLength / 2}px`,
          background: '#fff',
          border: '2px solid #4285f4',
          borderRadius: '4px',
          cursor: cursorStyle,
          pointerEvents: 'auto' as const,
          zIndex: 10,
        },
  }
}
</script>

<template>
  <!-- Ghost preview showing original position during rotation -->
  <div
    v-if="Number.isFinite(x0) && isRotating && !isArrow"
    :style="{
      position: 'absolute',
      zIndex: zIndex - 1,
      left: `${zoom * (displayX0 - displayWidth / 2)}px`,
      top: `${zoom * (displayY0 - displayHeight / 2)}px`,
      width: `${zoom * displayWidth}px`,
      height: `${zoom * displayHeight}px`,
      transformOrigin: 'center center',
      transform: `rotate(${rotationStartAngle}deg)`,
      pointerEvents: 'none',
      border: '1px solid rgba(66, 133, 244, 0.4)',
      background: 'rgba(66, 133, 244, 0.05)',
    }"
  />

  <div
    v-if="Number.isFinite(x0)"
    id="drag-control-container"
    :data-drag-id="dragId"
    :style="{
      position: 'absolute',
      zIndex,
      left: `${zoom * (displayX0 - displayWidth / 2)}px`,
      top: `${zoom * (displayY0 - displayHeight / 2)}px`,
      width: `${zoom * displayWidth}px`,
      height: `${zoom * displayHeight}px`,
      transformOrigin: 'center center',
      transform: `rotate(${rotate}deg)`,
      pointerEvents: 'none',
    }"
  >
    <!-- Normal selection mode -->
    <div v-if="!isCropping" class="absolute inset-0 z-nav dark:b-gray-400" :class="isArrow ? '' : 'b b-dark'">
      <template v-if="!autoHeight">
        <div v-bind="getCornerProps(true, true)" />
        <div v-bind="getCornerProps(false, false)" />
        <template v-if="!isArrow">
          <div v-bind="getCornerProps(true, false)" />
          <div v-bind="getCornerProps(false, true)" />
        </template>
      </template>
      <template v-if="!isArrow">
        <div v-bind="getBorderProps('l')" />
        <div v-bind="getBorderProps('r')" />
        <template v-if="!autoHeight">
          <div v-bind="getBorderProps('t')" />
          <div v-bind="getBorderProps('b')" />
        </template>
        <!-- Rotation handle with rotate icon -->
        <div v-bind="getRotateProps()">
          <!-- Rotate icon (circular arrow) -->
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#4285f4"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </div>
        <!-- Stem connecting rotation handle to element -->
        <div
          class="absolute w-0"
          :style="{
            left: '50%',
            top: `-${rotateHandleOffset - rotateHandleSize / 2}px`,
            height: `${rotateHandleOffset - rotateHandleSize / 2}px`,
            borderLeft: '1px solid #4285f4',
          }"
        />
        <!-- Angle display during rotation -->
        <div
          v-if="isRotating"
          class="absolute text-xs font-medium whitespace-nowrap"
          :style="{
            left: '50%',
            top: `-${rotateHandleOffset + rotateHandleSize + 4}px`,
            transform: `translateX(-50%) rotate(-${rotate}deg)`,
            color: '#4285f4',
            pointerEvents: 'none',
          }"
        >
          {{ Math.round(currentRotationAngle) }}°
        </div>
      </template>
    </div>

    <!-- Crop mode -->
    <div v-if="isCropping" class="absolute inset-0" :style="{ pointerEvents: 'auto' }" @dblclick="handleDblclick">
      <!-- Background: Full image at reduced opacity (shows what will be cropped out) -->
      <img
        v-if="imageSrc"
        :src="imageSrc"
        class="absolute inset-0 w-full h-full object-fill"
        :style="{ opacity: 0.35 }"
      >

      <!-- Foreground: Cropped region at full opacity (shows what will remain) -->
      <img
        v-if="imageSrc"
        :src="imageSrc"
        class="absolute inset-0 w-full h-full object-fill"
        :style="{
          clipPath: `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`,
        }"
      >

      <!-- Fallback for non-image elements: checkerboard overlay -->
      <template v-if="!imageSrc">
        <div
          class="absolute crop-overlay"
          :style="{ top: 0, left: 0, right: 0, height: `${cropTop}%` }"
        />
        <div
          class="absolute crop-overlay"
          :style="{ bottom: 0, left: 0, right: 0, height: `${cropBottom}%` }"
        />
        <div
          class="absolute crop-overlay"
          :style="{ top: `${cropTop}%`, left: 0, bottom: `${cropBottom}%`, width: `${cropLeft}%` }"
        />
        <div
          class="absolute crop-overlay"
          :style="{ top: `${cropTop}%`, right: 0, bottom: `${cropBottom}%`, width: `${cropRight}%` }"
        />
      </template>

      <!-- Crop region border - blue like Google's -->
      <div
        class="absolute"
        :style="{
          top: `${cropTop}%`,
          left: `${cropLeft}%`,
          right: `${cropRight}%`,
          bottom: `${cropBottom}%`,
          border: '2px solid #4285f4',
        }"
      />

      <!-- Crop handles - edges -->
      <div v-bind="getCropHandleProps('top')" />
      <div v-bind="getCropHandleProps('right')" />
      <div v-bind="getCropHandleProps('bottom')" />
      <div v-bind="getCropHandleProps('left')" />

      <!-- Crop handles - corners -->
      <div v-bind="getCropHandleProps('topLeft')" />
      <div v-bind="getCropHandleProps('topRight')" />
      <div v-bind="getCropHandleProps('bottomLeft')" />
      <div v-bind="getCropHandleProps('bottomRight')" />

      <!-- Crop mode toolbar -->
      <div
        class="absolute flex items-center gap-2 bg-white dark:bg-gray-800 rounded shadow-lg px-3 py-1.5 text-xs"
        :style="{
          bottom: '-40px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 101,
          pointerEvents: 'auto',
          whiteSpace: 'nowrap',
        }"
      >
        <span class="text-gray-500 dark:text-gray-400">Drag handles to crop</span>
        <button
          class="px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600"
          @click.stop="props.data.exitCropMode()"
        >
          Done
        </button>
      </div>
    </div>
    <!-- Floating toolbar (hidden in crop mode) -->
    <div
      v-if="!isCropping"
      class="absolute flex items-center gap-1 bg-white dark:bg-gray-800 rounded shadow-lg px-2 py-1 text-xs"
      :style="{
        top: '-32px',
        right: '0',
        zIndex: 101,
        pointerEvents: 'auto',
      }"
    >
      <!-- Reset aspect ratio button -->
      <button
        v-if="!isArrow && !autoHeight"
        class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        title="Reset aspect ratio"
        @click.stop="resetAspectRatio"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      </button>
      <!-- Z-order buttons -->
      <button
        class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        title="Bring forward (⌘↑)"
        @click.stop="bringForward"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button
        class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        title="Send backward (⌘↓)"
        @click.stop="sendBackward"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
    <!-- Floating link button (hidden in crop mode) -->
    <div
      v-if="associatedLink && !isCropping"
      class="absolute flex items-center gap-1 bg-white dark:bg-gray-800 rounded shadow-lg px-2 py-1 text-xs"
      :style="{
        bottom: '-32px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 101,
        pointerEvents: 'auto',
      }"
    >
      <a
        :href="associatedLink"
        target="_blank"
        rel="noopener noreferrer"
        class="text-blue-600 dark:text-blue-400 hover:underline max-w-40 truncate"
        @click.stop
      >
        {{ associatedLink }}
      </a>
      <button
        class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        title="Open link"
        @click.stop="openLink"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.crop-overlay {
  /* Semi-transparent checkerboard pattern for visibility on both light and dark backgrounds */
  background-color: rgba(0, 0, 0, 0.4);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.1) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.1) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.1) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.1) 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
}
</style>
