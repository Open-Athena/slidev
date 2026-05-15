import { describe, expect, it } from 'vitest'

// Pure snap math lives in `./snap` (extracted from `useDragElements`) so these
// tests don't need a Vue runtime or the vite virtual modules the composable
// transitively pulls in.
import { findSnap, getVisibleBounds } from '../packages/client/composables/snap'

function el(opts: {
  dragId?: string
  x0: number
  y0: number
  width: number
  height: number
  rotate?: number
  zIndex?: number
  cropTop?: number
  cropRight?: number
  cropBottom?: number
  cropLeft?: number
}) {
  return {
    dragId: opts.dragId ?? 'test',
    x0: () => opts.x0,
    y0: () => opts.y0,
    width: () => opts.width,
    height: () => opts.height,
    rotate: () => opts.rotate ?? 0,
    zIndex: () => opts.zIndex ?? 0,
    cropTop: () => opts.cropTop ?? 0,
    cropRight: () => opts.cropRight ?? 0,
    cropBottom: () => opts.cropBottom ?? 0,
    cropLeft: () => opts.cropLeft ?? 0,
  }
}

describe('getVisibleBounds', () => {
  it('uncropped element: visible bounds == raw bounds', () => {
    const bounds = getVisibleBounds(el({ x0: 100, y0: 50, width: 200, height: 100 }))
    expect(bounds).toEqual({ cx: 100, cy: 50, w: 200, h: 100 })
  })

  it('crop on all sides shrinks the visible rect', () => {
    // 20% off top + 20% off bottom = 60% of original height; 10% off each side = 80% of width.
    // No offset shift because crop is symmetric.
    const bounds = getVisibleBounds(el({
      x0: 100,
      y0: 50,
      width: 200,
      height: 100,
      cropTop: 20,
      cropBottom: 20,
      cropLeft: 10,
      cropRight: 10,
    }))
    expect(bounds.cx).toBe(100)
    expect(bounds.cy).toBe(50)
    expect(bounds.w).toBe(160)
    expect(bounds.h).toBe(60)
  })

  it('asymmetric crop shifts visible center', () => {
    // 40% off left, 0% off right → visible center moves right by 20% of width
    // 0% off top, 20% off bottom → visible center moves up by 10% of height
    const bounds = getVisibleBounds(el({
      x0: 0,
      y0: 0,
      width: 100,
      height: 100,
      cropLeft: 40,
      cropBottom: 20,
    }))
    // offX = (cL - cR)/100 * w/2 = (40 - 0)/100 * 50 = 20
    // offY = (cT - cB)/100 * h/2 = (0 - 20)/100 * 50 = -10
    expect(bounds.cx).toBe(20)
    expect(bounds.cy).toBe(-10)
    expect(bounds.w).toBe(60) // 100 - 40
    expect(bounds.h).toBe(80) // 100 - 20
  })

  it('90° rotation rotates the crop-offset shift', () => {
    // Same asymmetric crop, rotated 90° clockwise.
    // Local offset (20, -10) becomes (10, 20) in world coords after 90° rotation.
    const bounds = getVisibleBounds(el({
      x0: 0,
      y0: 0,
      width: 100,
      height: 100,
      cropLeft: 40,
      cropBottom: 20,
      rotate: 90,
    }))
    expect(bounds.cx).toBeCloseTo(10, 5)
    expect(bounds.cy).toBeCloseTo(20, 5)
    // Visible width/height are pre-rotation dimensions — the function returns
    // visW/visH in element-local space, not the rotated bounding box.
    expect(bounds.w).toBe(60)
    expect(bounds.h).toBe(80)
  })

  it('accessors are read live every call (reactivity smoke test)', () => {
    let crop = 0
    const elInfo = {
      dragId: 'live',
      x0: () => 0,
      y0: () => 0,
      width: () => 100,
      height: () => 100,
      rotate: () => 0,
      zIndex: () => 0,
      cropTop: () => crop,
      cropRight: () => 0,
      cropBottom: () => 0,
      cropLeft: () => 0,
    }
    expect(getVisibleBounds(elInfo).h).toBe(100)
    crop = 50 // simulating a Vue ref mutation between snap-target rebuilds
    expect(getVisibleBounds(elInfo).h).toBe(50)
  })
})

describe('findSnap', () => {
  it('returns input unchanged when no target is in range', () => {
    const r = findSnap(100, 50, [10, 200, 400])
    expect(r).toEqual({ value: 100, lines: [] })
  })

  it('snaps center to closest target within threshold', () => {
    // SNAP_THRESHOLD = 8 (internal); 102 is within 8 of 100, 96 is within 8 of 100.
    const r = findSnap(102, 0, [100])
    expect(r).toEqual({ value: 100, lines: [100] })
  })

  it('prefers center match over edge match when both qualify', () => {
    // value=100, halfSize=50: center=100, leftEdge=50, rightEdge=150.
    // target=102 is dist=2 from center, dist=48 from leftEdge — center wins.
    const r = findSnap(100, 50, [102])
    expect(r).toEqual({ value: 102, lines: [102] })
  })

  it('snaps the left edge to a target — element shifts right so edge meets target', () => {
    // value=100, halfSize=50, leftEdge=50. Target=53 is within 8 of leftEdge.
    // Result: edge snaps to 53, so center moves to 53 + halfSize = 103.
    const r = findSnap(100, 50, [53])
    expect(r).toEqual({ value: 103, lines: [53] })
  })

  it('snaps the right edge to a target — element shifts left', () => {
    // value=100, halfSize=50, rightEdge=150. Target=148 is within 8 of rightEdge.
    // Result: edge snaps to 148, so center moves to 148 - halfSize = 98.
    const r = findSnap(100, 50, [148])
    expect(r).toEqual({ value: 98, lines: [148] })
  })

  it('picks closest qualifier when multiple targets are in range', () => {
    // Three targets within threshold of value=100; closest wins.
    const r = findSnap(100, 0, [95, 102, 106])
    expect(r).toEqual({ value: 102, lines: [102] })
  })

  it('ignores targets just outside the 8-px threshold', () => {
    const r = findSnap(100, 0, [108]) // dist=8 — NOT < SNAP_THRESHOLD
    expect(r).toEqual({ value: 100, lines: [] })
    const r2 = findSnap(100, 0, [107]) // dist=7 — within threshold
    expect(r2).toEqual({ value: 107, lines: [107] })
  })

  it('halfSize=0 (resize handle): pure center-vs-target match', () => {
    // Resize handles pass halfSize=0 (the handle IS the edge being moved).
    const r = findSnap(200, 0, [197])
    expect(r).toEqual({ value: 197, lines: [197] })
  })
})

describe('snap math interaction with cropped elements', () => {
  it('cropped element snaps at its CROPPED edges, not raw edges', () => {
    // Target element at x=400, no crop. Its right edge is at 400 + 100/2 = 450.
    // Element being moved is 200 wide with 50% left crop → visHalfW = 200*(1-0.5)/2 = 50.
    // Proposed cursor center for the move puts visCX at 502; visCX - visHalfW = 452 (cropped
    // left edge). That's within 8 of target 450 → should snap cropped-left-edge to 450,
    // shifting cursor center to 450 + 50 = 500.
    const halfW = 200 * (100 - 50 - 0) / 200 // visHalfW for 50% left crop
    expect(halfW).toBe(50)
    const targets = [450]
    const r = findSnap(502, halfW, targets)
    // Left edge of cropped rect (502 - 50 = 452) is 2 away from 450 → snap edge to 450,
    // moving center to 450 + 50 = 500.
    expect(r).toEqual({ value: 500, lines: [450] })
  })
})
