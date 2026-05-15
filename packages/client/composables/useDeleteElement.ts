import type { SlidePatch } from '@slidev/types'
import { clearSelection, getSelectedElements } from './useMultiSelect'

// MVP delete: drop the markdown source line(s) for each selected element.
// Source-removal alone is enough to make the element disappear — once the slide
// markdown re-renders without the line, the v-drag wrapper unmounts and its
// registration is cleaned up via the existing `unmounted()` hook in
// `useDragElement`. The orphaned dragPos in `slides.coords.yaml` is harmless
// (just a stale key) and gets cleaned up the next time the user commits to YAML
// or hand-edits.
//
// Deferred for follow-up:
//   - Undo (needs a new `delete` EditKind that round-trips through the SQLite
//     event log with the removed source-line range stored in the payload).
//   - Cleanup of stale `slides.coords.yaml` dragPos entries.
//   - Group delete as a single event (today each selection is its own write).
//   - Toast / error feedback when an element can't be deleted (no
//     `markdownSource`, e.g. theme-rendered chrome).
//
// See `specs/delete-and-insert-flow.md` for the long-term plan.

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

// Strip lines `[startLine, endLine)` (0-indexed, end exclusive — markdown-it
// convention) from a slide's content. If both the line *before* the range and
// the line *after* are blank, drop one of them too to avoid leaving a
// double-blank gap where a paragraph used to live.
function removeLineRange(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n')
  const before = lines.slice(0, startLine)
  const after = lines.slice(endLine)
  // Collapse one of two flanking blank lines if both exist.
  if (before.length && after.length && before[before.length - 1] === '' && after[0] === '')
    after.shift()
  return [...before, ...after].join('\n')
}

export async function deleteSelectedElements(): Promise<{ deleted: number, skipped: number }> {
  const selected = Array.from(getSelectedElements())
  if (selected.length === 0)
    return { deleted: 0, skipped: 0 }

  // Group by slide so a single GET+POST round-trip per slide handles all
  // deletions on that slide (in particular, multi-select within a single slide
  // would otherwise GET stale content on the 2nd+ deletions).
  interface Range { dragId: string, start: number, end: number }
  const bySlide = new Map<number, Range[]>()
  let skipped = 0
  for (const state of selected) {
    if (!state.markdownSource) {
      console.warn('[Slidev] Delete skipped: element has no markdownSource', state.dragId)
      skipped++
      continue
    }
    const [start, end] = state.markdownSource
    const slideNo = state.page.value
    const list = bySlide.get(slideNo) ?? []
    list.push({ dragId: state.dragId, start, end })
    bySlide.set(slideNo, list)
  }

  let deleted = 0
  for (const [slideNo, ranges] of bySlide.entries()) {
    // Splice from highest line first so earlier indices stay valid.
    ranges.sort((a, b) => b.start - a.start)
    let content = await fetchSlideContent(slideNo)
    for (const r of ranges)
      content = removeLineRange(content, r.start, r.end)
    await patchSlideContent(slideNo, content)
    deleted += ranges.length
  }

  clearSelection()
  return { deleted, skipped }
}
