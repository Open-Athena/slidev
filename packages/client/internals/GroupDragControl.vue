<script setup lang="ts">
import type { DragElementState } from '../composables/useDragElements'
import { onKeyDown, useIntervalFn } from '@vueuse/core'
import { computed, inject, ref, watchEffect } from 'vue'
import { findSnap, getSnapTargets } from '../composables/useDragElements'
import { computeElementOffsets, computeGroupBounds } from '../composables/useGroupBounds'
import { clearSelection, getSelectedElements, selectionCount } from '../composables/useMultiSelect'
import { useSlideBounds } from '../composables/useSlideBounds'
import { injectionSlideScale } from '../constants'
import { slideHeight, slideWidth } from '../env'
import { magicKeys } from '../state'

// Reactive props computed from selection
const selectedElements = computed(() => Array.from(getSelectedElements()))
const count = selectionCount
const zoom = computed(() => selectedElements.value[0]?.zoom.value ?? 1)

// Compute group bounds reactively
const bounds = computed(() => computeGroupBounds(selectedElements.value))

const slideScale = inject(injectionSlideScale, ref(1))
const scale = computed(() => slideScale.value * zoom.value)
const { left: slideLeft, top: slideTop } = useSlideBounds()

const ctrlSize = 10
const minRemain = 10

// Active snap lines (from the primary element or group)
const activeSnapLines = ref<{ x: number[], y: number[] }>({ x: [], y: [] })

// Rotation state
const isRotating = ref(false)
const rotationStartAngle = ref(0)
const rotationStartMouseAngle = ref(0)
const currentRotationAngle = ref(0)
const rotationPivotX = ref(0)
const rotationPivotY = ref(0)

let currentDrag: {
  startMouseX: number
  startMouseY: number
  groupCenterX: number
  groupCenterY: number
  groupBounds: { minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }
  elementOffsets: Map<DragElementState, { offsetX: number, offsetY: number }>
  elementSnapshots: Map<DragElementState, {
    x0: number
    y0: number
    width: number
    height: number
    rotate: number
  }>
} | null = null

function onPointerdown(ev: PointerEvent) {
  if (ev.buttons !== 1 || !bounds.value)
    return

  ev.preventDefault()
  ev.stopPropagation()

  // Save snapshots for all selected elements
  for (const el of selectedElements.value) {
    el.saveSnapshot()
  }

  const elementSnapshots = new Map<DragElementState, { x0: number, y0: number, width: number, height: number, rotate: number }>()
  for (const el of selectedElements.value) {
    elementSnapshots.set(el, {
      x0: el.x0.value,
      y0: el.y0.value,
      width: el.width.value,
      height: el.height.value,
      rotate: el.rotate.value,
    })
  }

  currentDrag = {
    startMouseX: ev.clientX,
    startMouseY: ev.clientY,
    groupCenterX: bounds.value.centerX,
    groupCenterY: bounds.value.centerY,
    groupBounds: {
      minX: bounds.value.minX,
      minY: bounds.value.minY,
      maxX: bounds.value.maxX,
      maxY: bounds.value.maxY,
      width: bounds.value.width,
      height: bounds.value.height,
    },
    elementOffsets: computeElementOffsets(selectedElements.value, {
      x: bounds.value.centerX,
      y: bounds.value.centerY,
    }),
    elementSnapshots,
  }

  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
}

// Reserved for future snap alignment support
void findSnap
void getSnapTargets

function onPointermoveResize(ev: PointerEvent, isLeft: boolean, isTop: boolean) {
  if (!currentDrag || ev.buttons !== 1 || !bounds.value)
    return

  ev.preventDefault()
  ev.stopPropagation()

  // Calculate scale factor from mouse movement
  const mouseX = (ev.clientX - slideLeft.value) / scale.value
  const mouseY = (ev.clientY - slideTop.value) / scale.value

  // Use stored original bounds (not live bounds that change during resize)
  const origBounds = currentDrag.groupBounds

  // Determine anchor corner (opposite of dragged corner)
  const anchorX = isLeft ? origBounds.maxX : origBounds.minX
  const anchorY = isTop ? origBounds.maxY : origBounds.minY

  // Original dimensions from drag start
  const origWidth = origBounds.width
  const origHeight = origBounds.height

  // Calculate new dimensions based on mouse position
  let newWidth = isLeft ? (anchorX - mouseX) : (mouseX - anchorX)
  let newHeight = isTop ? (anchorY - mouseY) : (mouseY - anchorY)

  // Enforce minimum size
  const minSize = 40
  newWidth = Math.max(newWidth, minSize)
  newHeight = Math.max(newHeight, minSize)

  // With Shift: preserve aspect ratio
  if (ev.shiftKey) {
    const origRatio = origWidth / origHeight
    const newRatio = newWidth / newHeight
    if (newRatio > origRatio) {
      newWidth = newHeight * origRatio
    }
    else {
      newHeight = newWidth / origRatio
    }
  }

  // Calculate scale factors
  const scaleX = newWidth / origWidth
  const scaleY = newHeight / origHeight

  // New group center (accounting for anchor being fixed)
  const newCenterX = isLeft ? (anchorX - newWidth / 2) : (anchorX + newWidth / 2)
  const newCenterY = isTop ? (anchorY - newHeight / 2) : (anchorY + newHeight / 2)

  // Apply transformation to each element
  for (const el of selectedElements.value) {
    const snapshot = currentDrag.elementSnapshots.get(el)!
    const offset = currentDrag.elementOffsets.get(el)!

    // Scale position offset from original group center
    const newOffsetX = offset.offsetX * scaleX
    const newOffsetY = offset.offsetY * scaleY

    // New element position
    el.x0.value = newCenterX + newOffsetX
    el.y0.value = newCenterY + newOffsetY

    // Scale element dimensions (for non-arrow elements)
    if (!el.isArrow) {
      el.width.value = snapshot.width * scaleX
      el.height.value = snapshot.height * scaleY
    }
  }
}

function onPointerup(ev: PointerEvent) {
  if (!currentDrag)
    return

  ev.preventDefault()
  ev.stopPropagation()

  activeSnapLines.value = { x: [], y: [] }
  currentDrag = null
}

const ctrlClasses = `absolute border border-gray bg-gray dark:border-gray-500 dark:bg-gray-800 bg-opacity-30`

function getCornerProps(isLeft: boolean, isTop: boolean) {
  return {
    onPointerdown,
    onPointermove: (ev: PointerEvent) => onPointermoveResize(ev, isLeft, isTop),
    onPointerup,
    style: {
      width: `${ctrlSize}px`,
      height: `${ctrlSize}px`,
      margin: `-${ctrlSize / 2}px`,
      left: isLeft ? '0' : undefined,
      right: isLeft ? undefined : '0',
      top: isTop ? '0' : undefined,
      bottom: isTop ? undefined : '0',
      cursor: +isLeft + +isTop === 1 ? 'nesw-resize' : 'nwse-resize',
      pointerEvents: 'auto' as const,
    },
    class: ctrlClasses,
  }
}

const rotateHandleSize = 18
const rotateHandleOffset = 32

function getAngleFromPivot(clientX: number, clientY: number, pivotX: number, pivotY: number): number {
  const mouseX = (clientX - slideLeft.value) / scale.value
  const mouseY = (clientY - slideTop.value) / scale.value
  return Math.atan2(mouseX - pivotX, -(mouseY - pivotY)) * 180 / Math.PI
}

function getRotateProps() {
  return {
    onPointerdown: (ev: PointerEvent) => {
      if (ev.buttons !== 1 || !bounds.value)
        return
      ev.preventDefault()
      ev.stopPropagation()

      // Save snapshots
      for (const el of selectedElements.value) {
        el.saveSnapshot()
      }

      const elementSnapshots = new Map<DragElementState, { x0: number, y0: number, width: number, height: number, rotate: number }>()
      for (const el of selectedElements.value) {
        elementSnapshots.set(el, {
          x0: el.x0.value,
          y0: el.y0.value,
          width: el.width.value,
          height: el.height.value,
          rotate: el.rotate.value,
        })
      }

      rotationPivotX.value = bounds.value.centerX
      rotationPivotY.value = bounds.value.centerY
      rotationStartAngle.value = 0 // Group starts at 0 rotation
      currentRotationAngle.value = 0
      rotationStartMouseAngle.value = getAngleFromPivot(ev.clientX, ev.clientY, rotationPivotX.value, rotationPivotY.value)
      isRotating.value = true

      currentDrag = {
        startMouseX: ev.clientX,
        startMouseY: ev.clientY,
        groupCenterX: bounds.value.centerX,
        groupCenterY: bounds.value.centerY,
        groupBounds: {
          minX: bounds.value.minX,
          minY: bounds.value.minY,
          maxX: bounds.value.maxX,
          maxY: bounds.value.maxY,
          width: bounds.value.width,
          height: bounds.value.height,
        },
        elementOffsets: computeElementOffsets(selectedElements.value, {
          x: bounds.value.centerX,
          y: bounds.value.centerY,
        }),
        elementSnapshots,
      }

      ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
    },
    onPointermove: (ev: PointerEvent) => {
      if (!currentDrag || ev.buttons !== 1)
        return

      ev.preventDefault()
      ev.stopPropagation()

      const currentMouseAngle = getAngleFromPivot(ev.clientX, ev.clientY, rotationPivotX.value, rotationPivotY.value)
      let delta = currentMouseAngle - rotationStartMouseAngle.value

      // Snap to 15° with Shift
      if (ev.shiftKey) {
        delta = Math.round(delta / 15) * 15
      }

      currentRotationAngle.value = delta

      // Rotate each element around the group center
      const rad = delta * Math.PI / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)

      for (const el of selectedElements.value) {
        const snapshot = currentDrag.elementSnapshots.get(el)!
        const offset = currentDrag.elementOffsets.get(el)!

        // Rotate offset around group center
        const newOffsetX = offset.offsetX * cos - offset.offsetY * sin
        const newOffsetY = offset.offsetX * sin + offset.offsetY * cos

        el.x0.value = rotationPivotX.value + newOffsetX
        el.y0.value = rotationPivotY.value + newOffsetY

        // Add rotation delta to each element's individual rotation
        el.rotate.value = ((snapshot.rotate + delta) % 360 + 360) % 360
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
      pointerEvents: 'auto' as const,
      background: '#fff',
      border: '2px solid #4285f4',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  }
}

// Arrow key movement
const moveInterval = 20
const intervalFnOptions = {
  immediate: false,
  immediateCallback: false,
}

const moveLeft = useIntervalFn(() => {
  if (!bounds.value || bounds.value.maxX <= minRemain)
    return
  for (const el of selectedElements.value)
    el.x0.value--
}, moveInterval, intervalFnOptions)

const moveRight = useIntervalFn(() => {
  if (!bounds.value || bounds.value.minX >= slideWidth.value - minRemain)
    return
  for (const el of selectedElements.value)
    el.x0.value++
}, moveInterval, intervalFnOptions)

const moveUp = useIntervalFn(() => {
  if (!bounds.value || bounds.value.maxY <= minRemain)
    return
  for (const el of selectedElements.value)
    el.y0.value--
}, moveInterval, intervalFnOptions)

const moveDown = useIntervalFn(() => {
  if (!bounds.value || bounds.value.minY >= slideHeight.value - minRemain)
    return
  for (const el of selectedElements.value)
    el.y0.value++
}, moveInterval, intervalFnOptions)

watchEffect(() => {
  function shortcut(key: string, fn: { resume: () => void, pause: () => void }) {
    if (magicKeys[key].value)
      fn.resume()
    else fn.pause()
  }
  shortcut('left', moveLeft)
  shortcut('right', moveRight)
  shortcut('up', moveUp)
  shortcut('down', moveDown)
})

// Undo/redo
function undo() {
  for (const el of selectedElements.value)
    el.undo()
}

function redo() {
  for (const el of selectedElements.value)
    el.redo()
}

onKeyDown('z', (e) => {
  if (!e.metaKey && !e.ctrlKey)
    return
  e.preventDefault()
  if (e.shiftKey)
    redo()
  else
    undo()
})

// Escape to deselect
watchEffect(() => {
  if (magicKeys.escape?.value) {
    clearSelection()
  }
})
</script>

<template>
  <!-- Snap alignment guides -->
  <div
    v-for="lineX in activeSnapLines.x"
    :key="`snap-x-${lineX}`"
    class="snap-guide snap-guide-x"
    :style="{
      position: 'absolute',
      left: `${zoom * lineX}px`,
      top: 0,
      width: '1px',
      height: '100%',
      background: '#f43f5e',
      pointerEvents: 'none',
      zIndex: 9999,
    }"
  />
  <div
    v-for="lineY in activeSnapLines.y"
    :key="`snap-y-${lineY}`"
    class="snap-guide snap-guide-y"
    :style="{
      position: 'absolute',
      left: 0,
      top: `${zoom * lineY}px`,
      width: '100%',
      height: '1px',
      background: '#f43f5e',
      pointerEvents: 'none',
      zIndex: 9999,
    }"
  />

  <!-- Individual element selection borders -->
  <div
    v-for="el in selectedElements"
    :key="el.dragId"
    :style="{
      position: 'absolute',
      zIndex: el.zIndex.value,
      left: `${zoom * (el.x0.value - el.width.value / 2)}px`,
      top: `${zoom * (el.y0.value - el.height.value / 2)}px`,
      width: `${zoom * el.width.value}px`,
      height: `${zoom * el.height.value}px`,
      transformOrigin: 'center center',
      transform: `rotate(${el.rotate.value}deg)`,
      border: '2px solid #4285f4',
      borderRadius: '2px',
      pointerEvents: 'none',
    }"
  />

  <div
    v-if="bounds"
    id="group-drag-control-container"
    :style="{
      position: 'absolute',
      zIndex: 9998,
      left: `${zoom * bounds.minX}px`,
      top: `${zoom * bounds.minY}px`,
      width: `${zoom * bounds.width}px`,
      height: `${zoom * bounds.height}px`,
      pointerEvents: 'none',
    }"
  >
    <!-- Dashed border around group -->
    <div
      class="absolute inset-0"
      :style="{
        border: '2px dashed #4285f4',
        borderRadius: '2px',
      }"
    >
      <!-- Corner handles -->
      <div v-bind="getCornerProps(true, true)" />
      <div v-bind="getCornerProps(false, true)" />
      <div v-bind="getCornerProps(true, false)" />
      <div v-bind="getCornerProps(false, false)" />

      <!-- Rotation handle -->
      <div v-bind="getRotateProps()">
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
      <!-- Rotation stem -->
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
          transform: 'translateX(-50%)',
          color: '#4285f4',
          pointerEvents: 'none',
        }"
      >
        {{ Math.round(currentRotationAngle) }}°
      </div>
    </div>

    <!-- Selection count badge -->
    <div
      class="absolute flex items-center gap-1 bg-blue-500 text-white rounded-full px-2 py-0.5 text-xs font-medium"
      :style="{
        bottom: '-24px',
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }"
    >
      {{ count }} selected
    </div>
  </div>
</template>
