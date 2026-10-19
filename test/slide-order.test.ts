import { describe, expect, it } from 'vitest'
import { duplicateOrder, isIdentityOrder, matchSlides, moveOrder, renumbering, reorderCoords } from '../packages/slidev/node/slide-order'

const froms = (order: Array<{ from: number | null, copy?: boolean }>) => order.map(s => s.copy ? `${s.from}*` : String(s.from))

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

describe('matchSlides', () => {
  // A slide is `signature` or `signature:title`.
  const keys = (spec: string) => spec.split(' ').map((s) => {
    const [signature, title] = s.split(':')
    return { signature, title }
  })
  const match = (before: string, after: string) => {
    const { order, removed, ambiguous } = matchSlides(keys(before), keys(after))
    return { order: order.map(s => s.from == null ? '+' : String(s.from)).join(' '), removed, ambiguous }
  }

  it('is the identity for an unchanged deck, and for slides edited in place', () => {
    expect([
      match('a b c', 'a b c'),
      match('a b c', 'a B c'),
      match('a b c', 'A B C'),
    ]).toEqual([
      { order: '1 2 3', removed: [], ambiguous: [] },
      { order: '1 2 3', removed: [], ambiguous: [] },
      { order: '1 2 3', removed: [], ambiguous: [] },
    ])
  })

  it('shifts the slides after an inserted or removed one', () => {
    expect([
      match('a b c d', 'a x b c d'),
      match('a b c d', 'a c d'),
      match('a b c d', 'a b c d x y'),
      match('a b c d', 'x a b c d'),
    ]).toEqual([
      { order: '1 + 2 3 4', removed: [], ambiguous: [] },
      { order: '1 3 4', removed: [2], ambiguous: [] },
      { order: '1 2 3 4 + +', removed: [], ambiguous: [] },
      { order: '+ 1 2 3 4', removed: [], ambiguous: [] },
    ])
  })

  it('follows a moved slide', () => {
    expect([
      match('a b c d e', 'a c d b e'),
      match('a b c d e', 'a e b c d'),
    ]).toEqual([
      { order: '1 3 4 2 5', removed: [], ambiguous: [] },
      { order: '1 5 2 3 4', removed: [], ambiguous: [] },
    ])
  })

  it('tells an edited slide from an inserted one by its title', () => {
    expect([
      // `c` edited, `x` inserted before it.
      match('a b c:Gremlin d', 'a b x:Prompt C:Gremlin d'),
      // `b` removed, `c` edited.
      match('a b:Outline c:Gremlin d', 'a C:Gremlin d'),
      // `b` removed, `c` edited, `x` inserted: `c`'s title puts `b` before it and `x` after.
      match('a b:Outline c:Gremlin', 'a C:Gremlin x:Prompt'),
      // An edit that also retitles a slide, in place.
      match('a b:Outline c', 'a B:Agenda c'),
    ]).toEqual([
      { order: '1 2 + 3 4', removed: [], ambiguous: [] },
      { order: '1 3 4', removed: [2], ambiguous: [] },
      { order: '1 3 +', removed: [2], ambiguous: [] },
      { order: '1 2 3', removed: [], ambiguous: [] },
    ])
  })

  it('leaves slides it can\'t tell apart ambiguous', () => {
    expect([
      // An insert next to an edit, no titles to go by.
      match('a b c', 'a x B c'),
      // A duplicate: either copy could be the original.
      match('a b c', 'a b b c'),
    ]).toEqual([
      { order: '1 + + 3', removed: [], ambiguous: [2] },
      { order: '1 + + 3', removed: [], ambiguous: [2] },
    ])
  })

  it('pairs repeated identical slides in order', () => {
    expect(match('a s b s c', 'a s x b s c')).toEqual({ order: '1 2 + 3 4 5', removed: [], ambiguous: [] })
  })

  it('reports whether an order changes anything', () => {
    expect([
      isIdentityOrder(matchSlides(keys('a b'), keys('a B')).order, 2),
      isIdentityOrder(matchSlides(keys('a b'), keys('a x b')).order, 2),
      isIdentityOrder(matchSlides(keys('a b c'), keys('a b')).order, 3),
      isIdentityOrder(duplicateOrder(3, 2, 3), 3),
    ]).toEqual([true, false, false, false])
  })
})
