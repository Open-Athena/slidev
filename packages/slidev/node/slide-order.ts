import type { CoordsMap } from './coords'

// Reordering and duplicating slides (dev server, from the overview). An operation is described by
// the deck's new slide order: for each new position, the old slide number it comes from, and
// whether it's a copy. Slide-numbered state (`slides.coords.yaml`, the history database) is
// renumbered from the same description.

export interface Slot {
  /** The slide's number (1-based) before the operation. */
  from: number
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
    if (!slot.copy)
      map.set(slot.from, i + 1)
  })
  return map
}

/** `slides.coords.yaml` in the new order; copies get their original's positions. */
export function reorderCoords(coords: CoordsMap, order: Slot[]): CoordsMap {
  const out: CoordsMap = {}
  order.forEach((slot, i) => {
    const positions = coords[String(slot.from)]
    if (positions && Object.keys(positions).length)
      out[String(i + 1)] = { ...positions }
  })
  return out
}
