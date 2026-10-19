import { describe, expect, it } from 'vitest'

// Pure layout geometry lives in `./drag-layout` (used by `useDragElements`), so these tests don't
// need a Vue runtime or the vite virtual modules the composable transitively pulls in.
import { imageFitAsCrop, isBoxDecorated, paddingOriginWithin, parseObjectPosition, renderedImageRect } from '../packages/client/composables/drag-layout'

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

  it('overflows the box under `cover`, and under `none` for a larger image', () => {
    expect(renderedImageRect(box, wide, 'cover')).toEqual({ left: -200, top: 0, width: 800, height: 400 })
    expect(renderedImageRect(box, wide, 'cover', '0px 0%')).toEqual({ left: 0, top: 0, width: 800, height: 400 })
    expect(renderedImageRect(box, wide, 'none', 'right top')).toEqual({ left: -400, top: 0, width: 800, height: 400 })
  })

  it('is the whole box for `fill` and unloaded images', () => {
    const full = { left: 0, top: 0, width: 400, height: 400 }
    expect(renderedImageRect(box, wide, 'fill')).toEqual(full)
    expect(renderedImageRect(box, { width: 0, height: 0 }, 'contain')).toEqual(full)
  })
})

describe('imageFitAsCrop', () => {
  const wide = { width: 800, height: 400 }

  it('grows a `cover` image\'s box to the whole picture, cropped to what was visible', () => {
    // 400×300 picture covering a 344×190 box, `object-position: 0 25%`: scaled to 344×258, 68px
    // of overflow, 17px of it above.
    const box = { left: 60, top: 310, width: 344, height: 190 }
    const image = renderedImageRect(box, { width: 400, height: 300 }, 'cover', '0px 25%')
    expect(image).toEqual({ left: 0, top: -17, width: 344, height: 258 })
    expect(imageFitAsCrop(box, image)).toEqual({
      box: { left: 60, top: 293, width: 344, height: 258 },
      crop: { top: 17 / 258 * 100, right: 0, bottom: 51 / 258 * 100, left: 0 },
    })
  })

  it('shrinks a letterboxed image\'s box to its pixels, uncropped', () => {
    const box = { left: 10, top: 20, width: 400, height: 400 }
    expect(imageFitAsCrop(box, renderedImageRect(box, wide, 'contain'))).toEqual({
      box: { left: 10, top: 120, width: 400, height: 200 },
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  })

  it('crops one axis and shrinks the other when the image overflows only one', () => {
    // `none`: an 800×400 image in a 400×600 box, centered: 200px over each side, 100px bands.
    const box = { left: 0, top: 0, width: 400, height: 600 }
    expect(imageFitAsCrop(box, renderedImageRect(box, wide, 'none'))).toEqual({
      box: { left: -200, top: 100, width: 800, height: 400 },
      crop: { top: 0, right: 25, bottom: 0, left: 25 },
    })
  })
})

describe('parseObjectPosition', () => {
  const pos = (value: string) => parseObjectPosition(value).map(({ fraction, px }) => [fraction, px])

  it('parses keywords (either order) and percentages', () => {
    expect([
      pos('50% 50%'),
      pos('left top'),
      pos('top right'),
      pos('center'),
      pos('bottom'),
      pos('25% 75%'),
    ]).toEqual([
      [[0.5, 0], [0.5, 0]],
      [[0, 0], [0, 0]],
      [[1, 0], [0, 0]],
      [[0.5, 0], [0.5, 0]],
      [[0.5, 0], [1, 0]],
      [[0.25, 0], [0.75, 0]],
    ])
  })

  it('parses px lengths, as computed styles serialize `0`', () => {
    expect([
      pos('0px 6%'),
      pos('12px -4px'),
      pos('left 10px'),
    ]).toEqual([
      [[0, 0], [0.06, 0]],
      [[0, 12], [0, -4]],
      [[0, 0], [0, 10]],
    ])
  })

  it('parses edge offsets (3–4 values), measured from the named edge', () => {
    expect([
      pos('right 10px bottom 20%'),
      pos('bottom 10px right'),
      pos('left 25% top'),
    ]).toEqual([
      [[1, -10], [0.8, 0]],
      [[1, 0], [1, -10]],
      [[0.25, 0], [0, 0]],
    ])
  })

  it('centers what it can\'t parse', () => {
    expect(pos('calc(50% + 10px) 2em')).toEqual([[0.5, 0], [0.5, 0]])
  })
})

describe('isBoxDecorated', () => {
  const plain = {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    boxShadow: 'none',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    paddingTop: '0px',
    paddingRight: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
  }

  it('is false for a bare box, and true for anything that shows around the content', () => {
    expect([
      isBoxDecorated(plain),
      isBoxDecorated({ ...plain, backgroundColor: 'transparent' }),
      isBoxDecorated({ ...plain, backgroundColor: 'rgb(42, 39, 37)' }),
      isBoxDecorated({ ...plain, backgroundColor: 'rgba(42, 39, 37, 0.5)' }),
      isBoxDecorated({ ...plain, backgroundImage: 'linear-gradient(red, blue)' }),
      isBoxDecorated({ ...plain, boxShadow: 'rgb(0, 0, 0) 0px 2px 4px 0px' }),
      isBoxDecorated({ ...plain, borderLeftWidth: '1px' }),
      isBoxDecorated({ ...plain, paddingTop: '4px' }),
    ]).toEqual([false, false, true, true, true, true, true, true])
  })
})
