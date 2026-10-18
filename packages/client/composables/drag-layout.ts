// Layout geometry for v-drag elements that live inside layout containers (columns, grids, flex).
// Kept free of Vue / vite virtuals so it's unit-testable (see `test/drag-layout.test.ts`).

export interface Point { x: number, y: number }
export interface Rect { left: number, top: number, width: number, height: number }

interface OffsetNode {
  offsetLeft: number
  offsetTop: number
  clientLeft: number
  clientTop: number
  offsetParent: OffsetNode | Element | null
}

/**
 * Position of `node`'s padding box (the origin its absolutely/relatively positioned children are
 * placed against) within `ancestor`, in `ancestor`'s untransformed CSS pixels.
 *
 * Walks the `offsetParent` chain, so ancestor transforms (the slide's scale, the slide-enter
 * animation) don't affect the result — unlike `getBoundingClientRect`, which collapses to 0×0
 * while a parent is at `scale(0)`. Returns `null` if `ancestor` isn't on the chain.
 */
export function paddingOriginWithin(node: OffsetNode | null, ancestor: unknown): Point | null {
  let x = 0
  let y = 0
  let cur = node
  while (cur) {
    if (cur === ancestor)
      return { x, y }
    x += cur.offsetLeft + cur.clientLeft
    y += cur.offsetTop + cur.clientTop
    cur = cur.offsetParent as OffsetNode | null
  }
  return null
}

/**
 * Where an `<img>`'s pixels actually render inside its box, given `object-fit` / `object-position`.
 * For `contain` / `scale-down` the image is letterboxed; cropping or resizing the box then acts on
 * the empty bands rather than the picture. Returns the box itself for `fill` and for fits that
 * cover the whole box.
 */
export function renderedImageRect(
  box: { width: number, height: number },
  natural: { width: number, height: number },
  objectFit: string,
  objectPosition = '50% 50%',
): Rect {
  const full = { left: 0, top: 0, width: box.width, height: box.height }
  if (!natural.width || !natural.height || !box.width || !box.height)
    return full
  if (objectFit !== 'contain' && objectFit !== 'scale-down')
    return full
  let ratio = Math.min(box.width / natural.width, box.height / natural.height)
  if (objectFit === 'scale-down')
    ratio = Math.min(ratio, 1)
  const width = natural.width * ratio
  const height = natural.height * ratio
  const [px, py] = parseObjectPosition(objectPosition)
  return {
    left: (box.width - width) * px,
    top: (box.height - height) * py,
    width,
    height,
  }
}

const keywordFractions: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }

/** `object-position` as fractions of the free space; only keywords and percentages are supported. */
export function parseObjectPosition(value: string): [number, number] {
  const parts = value.trim().split(/\s+/)
  const toFraction = (part: string | undefined): number => {
    if (part == null)
      return 0.5
    if (part in keywordFractions)
      return keywordFractions[part]
    if (part.endsWith('%'))
      return Number.parseFloat(part) / 100
    return 0.5
  }
  // Keyword order may be swapped (`top left`); put the vertical keyword second.
  if (parts[0] === 'top' || parts[0] === 'bottom')
    parts.reverse()
  return [toFraction(parts[0]), toFraction(parts[1])]
}
