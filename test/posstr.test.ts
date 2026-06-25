import { describe, expect, it } from 'vitest'
import { posStrToSnapshot, snapshotToPosStr } from '../packages/slidev/node/state/core'

// Default-shaped snapshot — center at (200, 150), 100x60. All defaults trip elision.
function base(overrides: Partial<ReturnType<typeof posStrToSnapshot> & {}> = {}) {
  return {
    x0: 250, // left=200, width=100 → center=250
    y0: 180, // top=150, height=60 → center=180
    width: 100,
    height: 60,
    rotate: 0,
    zIndex: 100,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    cropLeft: 0,
    ...overrides,
  }
}

describe('snapshotToPosStr', () => {
  it('emits only x,y,w,h when all trailing fields are at defaults', () => {
    expect(snapshotToPosStr(base())).toBe('200,150,100,60')
  })

  it('rounds non-integer coords', () => {
    // x_top = x0 - w/2 = 250.4 - 50.245 = 200.155 → 200
    // y_top = y0 - h/2 = 180.6 - 30.255 = 150.345 → 150
    expect(snapshotToPosStr(base({ x0: 250.4, y0: 180.6, width: 100.49, height: 60.51 })))
      .toBe('200,150,100,61')
  })

  it('appends rotate when non-zero', () => {
    expect(snapshotToPosStr(base({ rotate: 45 }))).toBe('200,150,100,60,45')
  })

  it('appends rotate+zIndex when zIndex is non-default (rotate may stay 0)', () => {
    expect(snapshotToPosStr(base({ zIndex: 200 }))).toBe('200,150,100,60,0,200')
  })

  it('appends all crop fields when any crop is non-zero (forces rotate+zIndex inclusion)', () => {
    expect(snapshotToPosStr(base({ cropTop: 5 }))).toBe('200,150,100,60,0,100,5,0,0,0')
  })

  it('handles negative rotate', () => {
    expect(snapshotToPosStr(base({ rotate: -90 }))).toBe('200,150,100,60,-90')
  })
})

describe('posStrToSnapshot', () => {
  it('parses bare x,y,w,h with defaults filled in', () => {
    expect(posStrToSnapshot('200,150,100,60')).toEqual(base())
  })

  it('parses with rotate appended', () => {
    expect(posStrToSnapshot('200,150,100,60,45')).toEqual(base({ rotate: 45 }))
  })

  it('parses with rotate+zIndex appended', () => {
    expect(posStrToSnapshot('200,150,100,60,0,200')).toEqual(base({ zIndex: 200 }))
  })

  it('parses full form with crop fields', () => {
    expect(posStrToSnapshot('200,150,100,60,30,150,5,4,3,2')).toEqual(
      base({ rotate: 30, zIndex: 150, cropTop: 5, cropRight: 4, cropBottom: 3, cropLeft: 2 }),
    )
  })

  it('strips surrounding [...] (directive form)', () => {
    expect(posStrToSnapshot('[200,150,100,60]')).toEqual(base())
  })

  it('decodes height "_" as autoHeight → falls back to width', () => {
    const snap = posStrToSnapshot('200,150,100,_')
    expect(snap?.height).toBe(100) // falls back to width
    expect(snap?.y0).toBe(150 + 100 / 2)
  })

  it('decodes height "NaN" as autoHeight → falls back to width', () => {
    const snap = posStrToSnapshot('200,150,100,NaN')
    expect(snap?.height).toBe(100)
  })

  it('returns null on insufficient parts (< 3)', () => {
    expect(posStrToSnapshot('1,2')).toBeNull()
  })

  it('tolerates whitespace around tokens', () => {
    expect(posStrToSnapshot(' 200 , 150 , 100 , 60 ')).toEqual(base())
  })
})

describe('snapshot ↔ posStr round-trip', () => {
  const cases: Array<{ name: string, snap: ReturnType<typeof base> }> = [
    { name: 'defaults', snap: base() },
    { name: 'rotated', snap: base({ rotate: 45 }) },
    { name: 'rotated negative', snap: base({ rotate: -135 }) },
    { name: 'custom zIndex', snap: base({ zIndex: 1000 }) },
    { name: 'cropped uniformly', snap: base({ cropTop: 10, cropRight: 10, cropBottom: 10, cropLeft: 10 }) },
    { name: 'cropped asymmetrically', snap: base({ cropTop: 5, cropRight: 0, cropBottom: 12, cropLeft: 3 }) },
    { name: 'rotate + zIndex + crop', snap: base({ rotate: 30, zIndex: 200, cropTop: 7 }) },
    { name: 'origin-positioned element', snap: base({ x0: 50, y0: 30 }) },
  ]

  for (const { name, snap } of cases) {
    it(`round-trips: ${name}`, () => {
      const posStr = snapshotToPosStr(snap)
      const decoded = posStrToSnapshot(posStr)
      expect(decoded).toEqual(snap)
    })
  }
})
