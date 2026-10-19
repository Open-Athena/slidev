import { describe, expect, it } from 'vitest'
import { dropPosition } from '../packages/client/composables/slide-reorder'
import { clampDrawerWidth, parseDrawerState } from '../packages/client/composables/useSlidesDrawer'

describe('slides drawer state', () => {
  it('falls back to the defaults when nothing (or garbage) is stored', () => {
    const defaults = { visible: false, width: 200, mode: 'text' }
    expect(parseDrawerState(null)).toEqual(defaults)
    expect(parseDrawerState('')).toEqual(defaults)
    expect(parseDrawerState('{not json')).toEqual(defaults)
    expect(parseDrawerState('"str"')).toEqual(defaults)
    expect(parseDrawerState('null')).toEqual(defaults)
  })

  it('keeps valid fields and defaults the rest field by field', () => {
    expect(parseDrawerState('{"visible":true,"width":250,"mode":"live"}')).toEqual({ visible: true, width: 250, mode: 'live' })
    expect(parseDrawerState('{"visible":"yes","width":"wide","mode":"grid"}')).toEqual({ visible: false, width: 200, mode: 'text' })
    expect(parseDrawerState('{"visible":true}')).toEqual({ visible: true, width: 200, mode: 'text' })
  })

  it('clamps the width to [120, 400], rounding to whole pixels', () => {
    expect([50, 120, 199.6, 400, 900, Number.NaN].map(clampDrawerWidth)).toEqual([120, 120, 200, 400, 400, 200])
    expect(parseDrawerState('{"width":1000}').width).toEqual(400)
  })
})

describe('dropPosition', () => {
  it('accounts for the moved slide leaving its old position', () => {
    // Slide 3 dropped before / after slide 6 (moving down) and slide 6 before / after 3 (moving up).
    expect([
      dropPosition(3, 6, false),
      dropPosition(3, 6, true),
      dropPosition(6, 3, false),
      dropPosition(6, 3, true),
    ]).toEqual([5, 6, 3, 4])
  })

  it('never puts a slide in front of slide 1 (the headmatter)', () => {
    expect([dropPosition(4, 1, false), dropPosition(4, 2, false)]).toEqual([2, 2])
  })
})
