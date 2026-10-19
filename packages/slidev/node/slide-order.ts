import type { CoordsMap } from './coords'

// Reordering and duplicating slides (dev server, from the overview), and slides inserted, removed
// or moved by editing the markdown. A change is described by the deck's new slide order: for each
// new position, the old slide number it comes from, and whether it's a copy. Slide-numbered state
// (`slides.coords.yaml`, the history database) is renumbered from the same description.

export interface Slot {
  /** The slide's number (1-based) before the change; `null` for a slide new to the deck. */
  from: number | null
  /** A duplicate: gets the original's content and positions, but not its history. */
  copy?: boolean
}

function identity(count: number): Slot[] {
  return Array.from({ length: count }, (_, i) => ({ from: i + 1 }))
}

/**
 * Move slide `from` so it ends up at position `to` (both 1-based). Slide 1 holds the deck's
 * headmatter, so it can't move and nothing can move before it.
 */
export function moveOrder(count: number, from: number, to: number): Slot[] {
  checkMovable(count, from, to)
  const order = identity(count)
  const [moved] = order.splice(from - 1, 1)
  order.splice(to - 1, 0, moved)
  return order
}

/** Insert a copy of slide `from` at position `at` (1-based; the slides from `at` on shift down). */
export function duplicateOrder(count: number, from: number, at: number): Slot[] {
  checkMovable(count + 1, from, at)
  const order = identity(count)
  order.splice(at - 1, 0, { from, copy: true })
  return order
}

function checkMovable(count: number, from: number, to: number): void {
  for (const n of [from, to]) {
    if (!Number.isInteger(n) || n < 1 || n > count)
      throw new Error(`Slide ${n} is out of range (1–${count})`)
  }
  if (from === 1 || to === 1)
    throw new Error('Slide 1 holds the deck headmatter; it can\'t be moved, and slides can\'t move before it')
}

/** Old slide number → new, for the slides that keep their identity (copies excluded). */
export function renumbering(order: Slot[]): Map<number, number> {
  const map = new Map<number, number>()
  order.forEach((slot, i) => {
    if (slot.from != null && !slot.copy)
      map.set(slot.from, i + 1)
  })
  return map
}

/** `slides.coords.yaml` in the new order; copies get their original's positions. */
export function reorderCoords(coords: CoordsMap, order: Slot[]): CoordsMap {
  const out: CoordsMap = {}
  order.forEach((slot, i) => {
    const positions = slot.from != null ? coords[String(slot.from)] : undefined
    if (positions && Object.keys(positions).length)
      out[String(i + 1)] = { ...positions }
  })
  return out
}

/** What identifies a slide across edits of the markdown. */
export interface SlideKey {
  /** Its content and frontmatter (without positions): slides with equal signatures are the same. */
  signature: string
  title?: string
}

export interface SlideMatch {
  /** The new order: each slide's old number, or `null` for a slide new to the deck. */
  order: Slot[]
  /** Old slides no longer in the deck. */
  removed: number[]
  /**
   * Old slides with no new slide to call theirs, where it's unclear whether they were removed or
   * changed beyond recognition (some new slide in the same place is unmatched too).
   */
  ambiguous: number[]
}

/**
 * Match the deck's slides before and after an edit of its markdown (slides inserted, removed,
 * moved or changed), so slide-numbered state can follow its slide.
 *
 * 1. Identical slides (equal signatures) pair up, in order, when a signature occurs as often
 *    before as after. A duplicated slide doesn't, since either copy could be the original.
 * 2. The longest run of those pairs that kept its relative order anchors the rest; pairs outside
 *    it are slides that moved.
 * 3. Between consecutive anchors, the remaining slides changed. They pair up by title (when it's
 *    unique on both sides); those pairs split the gap further, and in each part the rest pair up
 *    by position when as many remain on each side. Leftover old slides were removed if no new
 *    slide is left in their part, else they're ambiguous.
 */
export function matchSlides(before: SlideKey[], after: SlideKey[]): SlideMatch {
  // New index → old index (0-based).
  const match: Array<number | null> = after.map(() => null)
  const taken = new Set<number>()
  const pair = (o: number, n: number) => {
    match[n] = o
    taken.add(o)
  }

  const bySignature = (keys: SlideKey[]) => {
    const map = new Map<string, number[]>()
    keys.forEach((k, i) => map.set(k.signature, [...(map.get(k.signature) ?? []), i]))
    return map
  }
  const afterBySignature = bySignature(after)
  for (const [signature, olds] of bySignature(before)) {
    const news = afterBySignature.get(signature)
    if (news?.length === olds.length)
      olds.forEach((o, k) => pair(o, news[k]))
  }

  const anchors = longestIncreasingRun(match.flatMap((o, n) => o == null ? [] : [{ o, n }]))
  const removed: number[] = []
  const ambiguous: number[] = []
  const bounds = [{ o: -1, n: -1 }, ...anchors, { o: before.length, n: after.length }]
  const unmatched = (from: { o: number, n: number }, to: { o: number, n: number }) => ({
    olds: range(from.o + 1, to.o).filter(o => !taken.has(o)),
    news: range(from.n + 1, to.n).filter(n => match[n] == null),
  })
  for (let b = 1; b < bounds.length; b++) {
    const { olds, news } = unmatched(bounds[b - 1], bounds[b])
    const titled = pairByTitle(olds.map(o => before[o].title), news.map(n => after[n].title))
      .map(([o, n]) => ({ o: olds[o], n: news[n] }))
      .sort((p, q) => p.n - q.n)
    titled.forEach(({ o, n }) => pair(o, n))
    // Slides matched by title split the gap further: what's left on either side of one stays there.
    const subBounds = [bounds[b - 1], ...longestIncreasingRun(titled), bounds[b]]
    for (let s = 1; s < subBounds.length; s++) {
      const rest = unmatched(subBounds[s - 1], subBounds[s])
      if (rest.olds.length === rest.news.length)
        rest.olds.forEach((o, k) => pair(o, rest.news[k]))
      else if (rest.news.length)
        ambiguous.push(...rest.olds.map(o => o + 1))
      else
        removed.push(...rest.olds.map(o => o + 1))
    }
  }

  return {
    order: match.map(o => ({ from: o == null ? null : o + 1 })),
    removed,
    ambiguous,
  }
}

/** Whether `order` leaves every slide where it was (and the deck the same length). */
export function isIdentityOrder(order: Slot[], count: number): boolean {
  return order.length === count && order.every((slot, i) => slot.from === i + 1 && !slot.copy)
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)
}

// Pairs (sorted by `n`) whose `o` increase, as many as possible.
function longestIncreasingRun(pairs: Array<{ o: number, n: number }>): Array<{ o: number, n: number }> {
  const length = pairs.map(() => 1)
  const prev = pairs.map(() => -1)
  for (let i = 0; i < pairs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pairs[j].o < pairs[i].o && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1
        prev[i] = j
      }
    }
  }
  const run: Array<{ o: number, n: number }> = []
  for (let end = length.indexOf(Math.max(...length)); end >= 0; end = prev[end])
    run.unshift(pairs[end])
  return run
}

// Indices (old, new) of titles that occur exactly once on each side.
function pairByTitle(olds: Array<string | undefined>, news: Array<string | undefined>): Array<[number, number]> {
  const unique = (titles: Array<string | undefined>, title: string) => titles.filter(t => t === title).length === 1
  return olds.flatMap((title, o): Array<[number, number]> =>
    title && unique(olds, title) && unique(news, title) ? [[o, news.indexOf(title)]] : [])
}
