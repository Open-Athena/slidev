import type { DragElementState } from './useDragElements'
import { appendSnippet, posToSnapshot } from './element-copy'
import { changedRange } from './list-edit'
import { initialState, pushTextEdit } from './useDragHistory'
import { addToSelection, clearSelection } from './useMultiSelect'

// Append new elements' markup to a slide as one undoable `text` history event: pasted /
// duplicated copies (`useCopyPaste.ts`), the insert picker's embeds and images. Appended at the
// end of the slide because auto ids (`img-x`, `img-x-2`, …) follow order of appearance:
// inserting earlier would renumber, and so move, later elements.

export interface NewElement {
  snippet: string
  /** The id the element will render with; `null` = don't select it after insertion. */
  dragId: string | null
  /** Its initial position string, or `null` to leave it where the layout puts it. */
  pos: string | null
}

export async function fetchSlide(no: number): Promise<{ content: string }> {
  const res = await fetch(`/__slidev/slides/${no}.json`)
  if (!res.ok)
    throw new Error(`Failed to fetch slide ${no} (${res.status})`)
  return res.json()
}

export async function insertElements(slideNo: number, items: NewElement[]): Promise<void> {
  const { content } = await fetchSlide(slideNo)
  let next = content
  for (const item of items)
    next = appendSnippet(next, item.snippet)
  // The positions go in the same history event as the inserted markup, so one ⌘Z undoes both;
  // seed the client's state cache so the new elements mount in place.
  const edits = items
    .filter((i): i is NewElement & { dragId: string, pos: string } => !!i.dragId && !!i.pos)
    .map(({ dragId, pos }) => ({ dragId, before: null, after: posToSnapshot(pos) }))
  if (initialState.value) {
    const slide = initialState.value[slideNo] ??= {}
    for (const { dragId, after } of edits)
      slide[dragId] = after
  }
  await pushTextEdit(slideNo, changedRange(content, next), edits)
  const res = await fetch(`/__slidev/slides/${slideNo}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ content: next, skipHmr: false }),
  })
  if (!res.ok)
    throw new Error(`Failed to patch slide ${slideNo} (${res.status})`)
  // Not awaited: the insert is done (the picker can close) while the slide re-renders.
  const ids = items.map(i => i.dragId).filter((id): id is string => !!id)
  if (ids.length)
    void selectWhenRendered(slideNo, ids)
}

// Select the new elements once the slide re-renders with them (each `v-drag` element carries its
// state as `draggingState`).
async function selectWhenRendered(slideNo: number, ids: string[]): Promise<void> {
  for (let tries = 0; tries < 50; tries++) {
    const states = ids
      .map(id => (document.querySelector(`.slidev-page-${slideNo} [data-drag-id="${CSS.escape(id)}"]`) as (HTMLElement & { draggingState?: DragElementState }) | null)?.draggingState)
      .filter((s): s is DragElementState => !!s)
    if (states.length === ids.length) {
      clearSelection()
      states.forEach(addToSelection)
      return
    }
    await new Promise(r => setTimeout(r, 100))
  }
}
