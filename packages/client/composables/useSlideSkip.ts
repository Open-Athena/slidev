import { computed } from 'vue'
import { slides } from '#slidev/slides'
import { isSkippedRoute } from '../logic/skip'
import { editMode, skipSkipped } from '../state'
import { showNotice } from './notice'
import { pushSkipEdit } from './useDragHistory'

// Slides marked `skip: true`: counted for the nav bar, flipped in edit mode (frontmatter `skip`,
// recorded in the edit history), and "skip skipped slides" toggled (⇧S).

export const skippedCount = computed(() => slides.value.filter(isSkippedRoute).length)

export function isSlideSkipped(no: number): boolean {
  return isSkippedRoute(slides.value[no - 1])
}

export function toggleSkipSkipped(): void {
  skipSkipped.value = !skipSkipped.value
  const n = skippedCount.value
  showNotice(skipSkipped.value
    ? `Skipping ${n} skipped slide${n === 1 ? '' : 's'}`
    : `Showing ${n} skipped slide${n === 1 ? '' : 's'}`)
}

/** Mark slide `no` skipped, or unmark it (dev, edit mode). Undoable. */
export async function toggleSlideSkip(no: number): Promise<void> {
  if (!__DEV__ || !editMode.value)
    return
  const before = isSlideSkipped(no) ? true : null
  const after = before ? null : true
  const res = await fetch(`/__slidev/slides/${no}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ frontmatter: { skip: after }, skipHmr: false }),
  })
  if (!res.ok)
    throw new Error(`Failed to patch slide ${no} (${res.status})`)
  await pushSkipEdit(no, before, after)
  showNotice(after ? `Slide ${no} will be skipped` : `Slide ${no} is no longer skipped`)
}
