import { showNotice } from './notice'

export type ReorderOp = 'move' | 'duplicate'

/**
 * The position a slide moved from `from` ends up at when dropped before (`after: false`) or after
 * slide `no`. Removing it first shifts the later slides up one, and slide 1 holds the deck's
 * headmatter, so nothing can land in front of it.
 */
export function dropPosition(from: number, no: number, after: boolean): number {
  const at = after ? no + 1 : no
  return Math.max(2, from < at ? at - 1 : at)
}

/**
 * Ask the dev server to move or copy slide `from` to position `to`; it rewrites the markdown and
 * renumbers positions and history. Reports the outcome in a notice; resolves whether it worked.
 */
export async function reorderSlides(op: ReorderOp, from: number, to: number): Promise<boolean> {
  const res = await fetch('/__slidev/slides/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ op, from, to }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
    showNotice(`Couldn't ${op === 'move' ? 'move' : 'copy'} slide ${from}: ${error}`)
    return false
  }
  showNotice(op === 'move' ? `Moved slide ${from} to ${to}` : `Copied slide ${from} to ${to}`)
  return true
}
