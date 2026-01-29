<script setup lang="ts">
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

// Store original aspect ratio for reset (computed to update when data changes)
const originalAspectRatio = computed(() => width.value / height.value)

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

const slideScale = inject(injectionSlideScale, ref(1))
const scale = computed(() => slideScale.value * zoom.value)
const { left: slideLeft, top: slideTop } = useSlideBounds()

const ctrlSize = 10
const minSize = computed(() => isArrow.value ? Number.NEGATIVE_INFINITY : 40)
const minRemain = 10

const rotateRad = computed(() => rotate.value * Math.PI / 180)
const rotateSin = computed(() => Math.sin(rotateRad.value))
const rotateCos = computed(() => Math.cos(rotateRad.value))

const boundingWidth = computed(() => width.value * rotateCos.value + height.value * rotateSin.value)
const boundingHeight = computed(() => width.value * rotateSin.value + height.value * rotateCos.value)

const boundingLeft = computed(() => x0.value - boundingWidth.value / 2)
const boundingTop = computed(() => y0.value - boundingHeight.value / 2)
const boundingRight = computed(() => x0.value + boundingWidth.value / 2)
const boundingBottom = computed(() => y0.value + boundingHeight.value / 2)

const arrowRevX = computed(() => isArrow.value && width.value < 0)
const arrowRevY = computed(() => isArrow.value && height.value < 0)

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

function onPointermove(ev: PointerEvent) {
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

function getRotateProps() {
  return {
    onPointerdown,
    onPointermove: (ev: PointerEvent) => {
      if (!currentDrag || ev.buttons !== 1)
        return

      ev.preventDefault()
      ev.stopPropagation()

      const x = (ev.clientX - slideLeft.value - currentDrag.dx0) / scale.value - ctrlSize / 4
      const y = (ev.clientY - slideTop.value - currentDrag.dy0) / scale.value - ctrlSize / 4

      let angle = Math.atan2(y - y0.value, x - x0.value) * 180 / Math.PI + 90

      const commonAngles = [0, 90, 180, 270, 360]
      for (const a of commonAngles) {
        if (Math.abs(angle - a) < 5) {
          angle = a % 360
          break
        }
      }

      rotate.value = angle
    },
    onPointerup,
    style: {
      width: `${ctrlSize}px`,
      height: `${ctrlSize}px`,
      margin: `-${ctrlSize / 2}px`,
      left: '50%',
      top: '-20px',
      cursor: 'grab',
      borderRadius: '50%',
      pointerEvents: 'auto',
    },
    class: ctrlClasses,
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
  // Reset to original aspect ratio, keeping width constant
  height.value = width.value / originalAspectRatio.value
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
</script>

<template>
  <div
    v-if="Number.isFinite(x0)"
    id="drag-control-container"
    :data-drag-id="dragId"
    :style="{
      position: 'absolute',
      zIndex: zIndex,
      left: `${zoom * (x0 - Math.abs(width) / 2)}px`,
      top: `${zoom * (y0 - Math.abs(height) / 2)}px`,
      width: `${zoom * Math.abs(width)}px`,
      height: `${zoom * Math.abs(height)}px`,
      transformOrigin: 'center center',
      transform: `rotate(${rotate}deg)`,
      pointerEvents: 'none',
    }"
  >
    <div class="absolute inset-0 z-nav dark:b-gray-400" :class="isArrow ? '' : 'b b-dark'">
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
        <div v-bind="getRotateProps()" />
        <div
          class="absolute -top-15px w-0 b b-dashed b-dark dark:b-gray-400"
          :style="{
            left: 'calc(50% - 1px)',
            height: autoHeight ? '14px' : '10px',
          }"
        />
      </template>
    </div>
    <!-- Floating toolbar -->
    <div
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
    <!-- Floating link button -->
    <div
      v-if="associatedLink"
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
