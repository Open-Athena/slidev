import type { DragElementState } from './useDragElements'
import { computed } from 'vue'
import { getSelectedElements } from './useMultiSelect'

export interface GroupBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  centerX: number
  centerY: number
}

/**
 * Compute the 4 corners of a rotated rectangle in world coordinates
 */
function getRotatedCorners(
  x0: number,
  y0: number,
  width: number,
  height: number,
  rotateDeg: number,
): { x: number, y: number }[] {
  const rad = rotateDeg * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const hw = width / 2
  const hh = height / 2

  // Local corners relative to center
  const localCorners = [
    { x: -hw, y: -hh }, // top-left
    { x: hw, y: -hh }, // top-right
    { x: hw, y: hh }, // bottom-right
    { x: -hw, y: hh }, // bottom-left
  ]

  // Rotate and translate to world coordinates
  return localCorners.map(({ x, y }) => ({
    x: x0 + x * cos - y * sin,
    y: y0 + x * sin + y * cos,
  }))
}

/**
 * Compute axis-aligned bounding box around multiple drag elements
 * Accounts for rotation by computing corners of each rotated element
 */
export function computeGroupBounds(elements: Set<DragElementState> | DragElementState[]): GroupBounds | null {
  const elementArray = Array.isArray(elements) ? elements : Array.from(elements)
  if (elementArray.length === 0)
    return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const el of elementArray) {
    const corners = getRotatedCorners(
      el.x0.value,
      el.y0.value,
      el.width.value,
      el.height.value,
      el.rotate.value,
    )

    for (const corner of corners) {
      minX = Math.min(minX, corner.x)
      minY = Math.min(minY, corner.y)
      maxX = Math.max(maxX, corner.x)
      maxY = Math.max(maxY, corner.y)
    }
  }

  const width = maxX - minX
  const height = maxY - minY

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
  }
}

/**
 * Reactive computed that returns current group bounds for selected elements
 */
export const groupBounds = computed((): GroupBounds | null => {
  return computeGroupBounds(getSelectedElements())
})

/**
 * Compute relative positions of elements within the group
 * Returns offset from group center for each element
 */
export function computeElementOffsets(
  elements: DragElementState[],
  groupCenter: { x: number, y: number },
): Map<DragElementState, { offsetX: number, offsetY: number }> {
  const offsets = new Map<DragElementState, { offsetX: number, offsetY: number }>()

  for (const el of elements) {
    offsets.set(el, {
      offsetX: el.x0.value - groupCenter.x,
      offsetY: el.y0.value - groupCenter.y,
    })
  }

  return offsets
}
