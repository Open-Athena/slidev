import type { SlidePatch } from '@slidev/types'
import type { ElementSnapshot } from './state-client'
import type { DragElementState } from './useDragElements'
import { sliceLineRange } from './delete-source'
import { findElement, removeRange } from './element-copy'
import { changedRange } from './list-edit'
import { showNotice } from './notice'
import { pushDelete, pushTextEdit } from './useDragHistory'
import { clearSelection, getSelectedElements } from './useMultiSelect'

// Delete a selected v-drag element by stripping the markdown lines that produced it. Each
// element becomes its own `kind: 'delete'` event in the SQLite event log; Cmd+Z unwinds
// them LIFO. The event payload carries the *exact* splice (start, end, lines) that was
// applied — including any blank-line collapsing — so undo can re-insert the same bytes at
// the same position. See `pushDelete` / `applyDeleteSplice` in `useDragHistory.ts` for the
// undo/redo plumbing on the server side.
//
// Deferred:
//   - Cleanup of stale `slides.coords.yaml` dragPos entries (no-op now; harmless leftovers).
//   - Group delete as a single event (multi-select today emits one event per element with a
//     source range, plus one per slide for the rest; ⌘Z unwinds them one at a time).

async function fetchSlideContent(no: number): Promise<string> {
  const res = await fetch(`/__slidev/slides/${no}.json`)
  if (!res.ok)
    throw new Error(`Failed to fetch slide ${no} (${res.status})`)
  const json = await res.json()
  return json.content as string
}

async function patchSlideContent(no: number, content: string): Promise<void> {
  const patch: SlidePatch = { content, skipHmr: false }
  const res = await fetch(`/__slidev/slides/${no}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok)
    throw new Error(`Failed to patch slide ${no} (${res.status})`)
}

export async function deleteSelectedElements(): Promise<{ deleted: number, skipped: number }> {
  const selected = Array.from(getSelectedElements())
  if (selected.length === 0)
    return { deleted: 0, skipped: 0 }

  interface Job {
    dragId: string
    slideNo: number
    start: number
    end: number
    before: ElementSnapshot
  }
  const jobs: Job[] = []
  let skipped = 0
  // Elements from HTML (`draggableImages: all`, `draggableComponents`) carry no source range;
  // their markup is found in the slide instead (`findElement`), per slide.
  const unmapped = new Map<number, DragElementState[]>()
  for (const state of selected) {
    if (!state.markdownSource) {
      const list = unmapped.get(state.page.value) ?? []
      list.push(state)
      unmapped.set(state.page.value, list)
      continue
    }
    const [start, end] = state.markdownSource
    jobs.push({
      dragId: state.dragId,
      slideNo: state.page.value,
      start,
      end,
      before: {
        x0: state.x0.value,
        y0: state.y0.value,
        width: state.width.value,
        height: state.height.value,
        rotate: state.rotate.value,
        zIndex: state.zIndex.value,
        cropTop: state.cropTop.value,
        cropRight: state.cropRight.value,
        cropBottom: state.cropBottom.value,
        cropLeft: state.cropLeft.value,
      },
    })
  }
  // Process highest-line first so each splice's `start/end` stays valid against the
  // working content (everything below this element is untouched at this point). Recording
  // the splice relative to the working content at splice time means LIFO undo re-inserts
  // at the position the markdown was in just before this delete fired.
  jobs.sort((a, b) => b.slideNo - a.slideNo || b.start - a.start)

  // Per-slide working content, mutated across multiple jobs targeting the same slide.
  const working = new Map<number, string>()
  let deleted = 0
  for (const job of jobs) {
    let content = working.get(job.slideNo)
    if (content === undefined)
      content = await fetchSlideContent(job.slideNo)
    const result = sliceLineRange(content, job.start, job.end)
    working.set(job.slideNo, result.content)
    await pushDelete(job.slideNo, job.dragId, job.before, {
      lineRange: [result.removed.start, result.removed.end],
      lines: result.removed.lines,
    })
    deleted++
  }
  // POST each slide's final content once. HMR fires after this and unmounts the deleted
  // elements; the server-side event log already reflects the delete.
  for (const [slideNo, content] of working)
    await patchSlideContent(slideNo, content)

  // Unmapped elements: remove their markup (bottom-up, so earlier offsets and `-2`-style
  // occurrences stay valid), as one text edit per slide. Undo restores the markup, and the
  // element's position is still in the history state, so it comes back where it was.
  for (const [slideNo, states] of unmapped) {
    const content = await fetchSlideContent(slideNo)
    const ranges = states.map((state) => {
      const src = state.container.value?.tagName === 'IMG' ? state.container.value.getAttribute('src') : null
      const at = findElement(content, { src, dragId: state.dragId })
      if (!at) {
        console.warn('[Slidev] Delete skipped: element\'s markup not found in the slide', state.dragId)
        skipped++
      }
      return at
    }).filter(r => r != null).sort((a, b) => b.start - a.start)
    let next = content
    for (const r of ranges)
      next = removeRange(next, r.start, r.end)
    if (next === content)
      continue
    await patchSlideContent(slideNo, next)
    await pushTextEdit(slideNo, changedRange(content, next))
    deleted += ranges.length
  }

  if (skipped)
    showNotice(`${skipped === 1 ? 'This element isn\'t' : `${skipped} elements aren't`} deletable from the slide source`)
  clearSelection()
  return { deleted, skipped }
}
