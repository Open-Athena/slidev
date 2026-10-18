import { describe, expect, it } from 'vitest'

// Pure layout geometry lives in `./drag-layout` (used by `useDragElements`), so these tests don't
// need a Vue runtime or the vite virtual modules the composable transitively pulls in.
import { paddingOriginWithin, parseObjectPosition, renderedImageRect } from '../packages/client/composables/drag-layout'

function node(offsetLeft: number, offsetTop: number, offsetParent: any, clientLeft = 0, clientTop = 0) {
  return { offsetLeft, offsetTop, clientLeft, clientTop, offsetParent }
}

describe('paddingOriginWithin', () => {
  const slide = node(0, 0, null)
  const page = node(0, 0, slide)

  it('is (0, 0) for the slide itself', () => {
    expect(paddingOriginWithin(slide, slide)).toEqual({ x: 0, y: 0 })
  })

  it('sums offsets (and borders) up to the slide', () => {
    // Two-cols: `.col { position: relative }`, second column at (530, 120) with a 1px left border.
    const col = node(530, 120, page, 1, 0)
    expect(paddingOriginWithin(col, slide)).toEqual({ x: 531, y: 120 })
  })

  it('is null when the slide is not an ancestor', () => {
    const elsewhere = node(10, 10, null)
    expect(paddingOriginWithin(elsewhere, slide)).toBeNull()
    expect(paddingOriginWithin(null, slide)).toBeNull()
  })
})

describe('renderedImageRect', () => {
  const box = { width: 400, height: 400 }
  const wide = { width: 800, height: 400 }

  it('letterboxes `contain` vertically for a wide image', () => {
    expect(renderedImageRect(box, wide, 'contain')).toEqual({ left: 0, top: 100, width: 400, height: 200 })
  })

  it('honors `object-position`', () => {
    expect(renderedImageRect(box, wide, 'contain', '0% 0%')).toEqual({ left: 0, top: 0, width: 400, height: 200 })
    expect(renderedImageRect(box, wide, 'contain', 'center bottom')).toEqual({ left: 0, top: 200, width: 400, height: 200 })
  })

  it('never upscales under `scale-down`', () => {
    expect(renderedImageRect(box, { width: 100, height: 50 }, 'scale-down')).toEqual({ left: 150, top: 175, width: 100, height: 50 })
  })

  it('is the whole box for `fill`, `cover`, and unloaded images', () => {
    const full = { left: 0, top: 0, width: 400, height: 400 }
    expect(renderedImageRect(box, wide, 'fill')).toEqual(full)
    expect(renderedImageRect(box, wide, 'cover')).toEqual(full)
    expect(renderedImageRect(box, { width: 0, height: 0 }, 'contain')).toEqual(full)
  })
})

describe('parseObjectPosition', () => {
  it('parses keywords (either order) and percentages', () => {
    expect([
      parseObjectPosition('50% 50%'),
      parseObjectPosition('left top'),
      parseObjectPosition('top right'),
      parseObjectPosition('center'),
      parseObjectPosition('25% 75%'),
    ]).toEqual([
      [0.5, 0.5],
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [0.25, 0.75],
    ])
  })
})
