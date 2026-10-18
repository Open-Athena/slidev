import { describe, expect, it } from 'vitest'
import { duplicateOrder, moveOrder, renumbering, reorderCoords } from '../packages/slidev/node/slide-order'

const froms = (order: Array<{ from: number, copy?: boolean }>) => order.map(s => s.copy ? `${s.from}*` : String(s.from))

describe('slide order', () => {
  it('moves a slide to a new position, either direction', () => {
    expect([
      froms(moveOrder(5, 2, 4)),
      froms(moveOrder(5, 5, 2)),
      froms(moveOrder(5, 3, 3)),
    ]).toEqual([
      ['1', '3', '4', '2', '5'],
      ['1', '5', '2', '3', '4'],
      ['1', '2', '3', '4', '5'],
    ])
  })

  it('inserts a copy of a slide at a position', () => {
    expect([
      froms(duplicateOrder(4, 2, 3)),
      froms(duplicateOrder(4, 4, 2)),
      froms(duplicateOrder(4, 3, 5)),
    ]).toEqual([
      ['1', '2', '2*', '3', '4'],
      ['1', '4*', '2', '3', '4'],
      ['1', '2', '3', '4', '3*'],
    ])
  })

  it('keeps slide 1 (the headmatter) first, and rejects out-of-range slides', () => {
    expect(() => moveOrder(5, 1, 3)).toThrow('Slide 1 holds the deck headmatter')
    expect(() => moveOrder(5, 3, 1)).toThrow('Slide 1 holds the deck headmatter')
    expect(() => moveOrder(5, 3, 6)).toThrow('Slide 6 is out of range (1–5)')
    expect(() => duplicateOrder(4, 2, 6)).toThrow('Slide 6 is out of range (1–5)')
  })

  it('renumbers slides that keep their identity, not copies', () => {
    expect([...renumbering(moveOrder(5, 2, 4))]).toEqual([[1, 1], [3, 2], [4, 3], [2, 4], [5, 5]])
    expect([...renumbering(duplicateOrder(4, 2, 3))]).toEqual([[1, 1], [2, 2], [3, 4], [4, 5]])
  })

  it('reorders coords, copying an original\'s positions to its copy', () => {
    const coords = { 2: { a: '1,2,3,4' }, 4: { b: '5,6,7,8' } }
    expect(reorderCoords(coords, moveOrder(5, 2, 4))).toEqual({ 3: { b: '5,6,7,8' }, 4: { a: '1,2,3,4' } })
    expect(reorderCoords(coords, duplicateOrder(4, 2, 3))).toEqual({ 2: { a: '1,2,3,4' }, 3: { a: '1,2,3,4' }, 5: { b: '5,6,7,8' } })
  })
})
