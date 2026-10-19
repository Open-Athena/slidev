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
 * Where an `<img>`'s pixels render relative to its box, given `object-fit` / `object-position`.
 * `contain` / `scale-down` letterbox the image inside the box; `cover` (and `none`, for an image
 * larger than its box) overflow it, the box clipping the overflow. `fill` and unloaded images
 * (no natural size) give the box itself.
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
  const contain = Math.min(box.width / natural.width, box.height / natural.height)
  let ratio: number
  if (objectFit === 'contain')
    ratio = contain
  else if (objectFit === 'scale-down')
    ratio = Math.min(contain, 1)
  else if (objectFit === 'cover')
    ratio = Math.max(box.width / natural.width, box.height / natural.height)
  else if (objectFit === 'none')
    ratio = 1
  else
    return full
  const width = natural.width * ratio
  const height = natural.height * ratio
  const [px, py] = parseObjectPosition(objectPosition)
  return {
    left: px.fraction * (box.width - width) + px.px,
    top: py.fraction * (box.height - height) + py.px,
    width,
    height,
  }
}

type BoxStyle = Pick<CSSStyleDeclaration, 'backgroundColor' | 'backgroundImage' | 'boxShadow'
  | 'borderTopWidth' | 'borderRightWidth' | 'borderBottomWidth' | 'borderLeftWidth'
  | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'>

/**
 * Whether an element's box shows anything beyond its content (a background, border, shadow or
 * padding), so letterbox bands around a fitted image are visible rather than empty.
 */
export function isBoxDecorated(style: BoxStyle): boolean {
  const transparent = /^(?:transparent|rgba\(.*,\s*0\)|rgb\(.*\/\s*0\))$/
  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
  return !transparent.test(style.backgroundColor)
    || (style.backgroundImage !== '' && style.backgroundImage !== 'none')
    || (style.boxShadow !== '' && style.boxShadow !== 'none')
    || sides.some(s => Number.parseFloat(style[`border${s}Width`]) > 0 || Number.parseFloat(style[`padding${s}`]) > 0)
}

export interface Crop { top: number, right: number, bottom: number, left: number }

/**
 * The drag editor's model of a fitted image: a box at the image's own aspect ratio, cropped (in
 * percent of that box, as `clip-path: inset(…)` renders it) to the part of it that's visible.
 * `box` is the element's box, `image` where its pixels render relative to it
 * (`renderedImageRect`); the result's box is in `box`'s coordinates. For a `cover`-fitted image
 * the box grows to the whole picture and the crop hides what the element's box clipped; for a
 * letterboxed one it shrinks to the pixels, uncropped.
 */
export function imageFitAsCrop(box: Rect, image: Rect): { box: Rect, crop: Crop } {
  const left = Math.max(image.left, 0)
  const top = Math.max(image.top, 0)
  const right = Math.min(image.left + image.width, box.width)
  const bottom = Math.min(image.top + image.height, box.height)
  const pct = (v: number, of: number) => Math.max(0, v / of * 100)
  return {
    box: { left: box.left + image.left, top: box.top + image.top, width: image.width, height: image.height },
    crop: {
      top: pct(top - image.top, image.height),
      right: pct(image.left + image.width - right, image.width),
      bottom: pct(image.top + image.height - bottom, image.height),
      left: pct(left - image.left, image.width),
    },
  }
}

/** One axis of `object-position`: the offset is `fraction` of the free space plus `px`. */
export interface AxisPosition { fraction: number, px: number }

const keywordFractions: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }
const center: AxisPosition = { fraction: 0.5, px: 0 }

/**
 * `object-position` (as `getComputedStyle` serializes it: keywords, percentages and px lengths,
 * in the 1–4 value forms) as an offset per axis. Unsupported values (`calc()`, other units) fall
 * back to centered.
 */
export function parseObjectPosition(value: string): [AxisPosition, AxisPosition] {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  const length = (part: string | undefined): AxisPosition | null => {
    if (part == null)
      return null
    if (part.endsWith('%'))
      return { fraction: Number.parseFloat(part) / 100, px: 0 }
    if (part.endsWith('px') || /^-?[\d.]+$/.test(part))
      return { fraction: 0, px: Number.parseFloat(part) }
    return null
  }
  const isKeyword = (part: string | undefined) => part != null && part in keywordFractions
  const isVertical = (part: string | undefined) => part === 'top' || part === 'bottom'
  const isHorizontal = (part: string | undefined) => part === 'left' || part === 'right'

  // 3–4 values: edge keywords, each optionally followed by an offset from that edge.
  if (parts.length > 2) {
    let x = center
    let y = center
    for (let i = 0; i < parts.length; i++) {
      const edge = parts[i]
      if (!isKeyword(edge))
        return [center, center]
      const offset = isKeyword(parts[i + 1]) ? null : length(parts[i + 1])
      if (offset)
        i++
      const fromEnd = edge === 'right' || edge === 'bottom'
      const axis = offset
        ? { fraction: fromEnd ? 1 - offset.fraction : offset.fraction, px: fromEnd ? 0 - offset.px : offset.px }
        : { fraction: keywordFractions[edge], px: 0 }
      if (isVertical(edge))
        y = axis
      else
        x = axis
    }
    return [x, y]
  }

  // Keyword order may be swapped (`top left`); put the vertical value second.
  if (isVertical(parts[0]) || isHorizontal(parts[1]))
    parts.reverse()
  if (parts.length === 1 && isVertical(parts[0]))
    parts.unshift('center')
  const axis = (part: string | undefined): AxisPosition =>
    part != null && isKeyword(part) ? { fraction: keywordFractions[part], px: 0 } : length(part) ?? center
  return [axis(parts[0]), axis(parts[1])]
}
