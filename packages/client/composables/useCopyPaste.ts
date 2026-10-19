import type { CopiedElement } from './element-copy'
import type { DragElementState } from './useDragElements'
import { onMounted, onUnmounted } from 'vue'
import { editMode, isInputting } from '../state'
import { appendSnippet, elementSnippet, idForCopy, offsetPos, posToSnapshot } from './element-copy'
import { changedRange } from './list-edit'
import { showNotice } from './notice'
import { getDragElementsForPage } from './useDragElements'
import { initialState, pushTextEdit } from './useDragHistory'
import { getSelectedElements } from './useMultiSelect'
import { useNav } from './useNav'

// ⌘C / ⌘V on selected draggable elements (edit mode, dev): ⌘C copies their markdown (so pasting
// into an editor works too); ⌘V appends copies to the current slide, 20 px down-right of the
// original (further for each repeated paste), with ids of their own. Appended at the end of the
// slide because auto ids (`img-x`, `img-x-2`, …) follow order of appearance: inserting earlier
// would renumber, and so move, later elements. One undoable history event per paste.

let copied: { items: CopiedElement[], text: string, slideNo: number, pastes: number } | null = null

const OFFSET = 20

// The element's position string, as the drag watcher writes it.
function posOf(state: DragElementState): string | null {
  const [x0, y0, w, h] = [state.x0.value, state.y0.value, state.width.value, state.height.value]
  if (!Number.isFinite(x0))
    return null
  let pos = [x0 - w / 2, y0 - h / 2, w].map(Math.round).join()
  pos += state.autoHeight ? ',_' : `,${Math.round(h)}`
  const crop = [state.cropTop, state.cropRight, state.cropBottom, state.cropLeft].map(r => Math.round(r.value))
  const hasCrop = crop.some(Boolean)
  const z = state.zIndex.value
  if (Math.round(state.rotate.value) || z !== 100 || hasCrop)
    pos += `,${Math.round(state.rotate.value)}`
  if (z !== 100 || hasCrop)
    pos += `,${Math.round(z)}`
  if (hasCrop)
    pos += `,${crop.join()}`
  return pos
}

async function fetchSlide(no: number): Promise<{ content: string }> {
  const res = await fetch(`/__slidev/slides/${no}.json`)
  if (!res.ok)
    throw new Error(`Failed to fetch slide ${no} (${res.status})`)
  return res.json()
}

async function copySelected(): Promise<void> {
  const items: CopiedElement[] = []
  let slideNo = 0
  for (const state of getSelectedElements()) {
    slideNo = state.page.value
    const { content } = await fetchSlide(slideNo)
    const src = state.container.value?.tagName === 'IMG' ? state.container.value.getAttribute('src') : null
    const el = { src, dragId: state.dragId }
    // Elements from HTML (`draggableImages: all`, `draggableComponents`) have no source range;
    // find their markup in the slide instead.
    const snippet = state.markdownSource
      ? elementSnippet(content.split('\n').slice(state.markdownSource[0], state.markdownSource[1]), el)
      : elementSnippet(content.split('\n'), el, false)
    if (snippet)
      items.push({ snippet, dragId: state.dragId, pos: posOf(state) })
  }
  if (!items.length)
    return
  const text = items.map(i => i.snippet).join('\n\n')
  copied = { items, text, slideNo, pastes: 0 }
  await navigator.clipboard?.writeText(text).catch(() => {})
  showNotice(`Copied ${items.length === 1 ? items[0].dragId : `${items.length} elements`}: ⌘V pastes a copy`)
}

async function paste(): Promise<void> {
  if (!copied)
    return
  const { currentSlideNo } = useNav()
  const slideNo = currentSlideNo.value
  const { content } = await fetchSlide(slideNo)
  copied.pastes++
  const shift = slideNo === copied.slideNo ? OFFSET * copied.pastes : OFFSET * (copied.pastes - 1)
  const ids = getDragElementsForPage(slideNo).map(e => e.dragId)
  const positions: Record<string, string> = {}
  let next = content
  for (const item of copied.items) {
    const { snippet, dragId } = idForCopy(item.snippet, item.dragId, ids)
    ids.push(dragId)
    next = appendSnippet(next, snippet)
    if (item.pos)
      positions[dragId] = offsetPos(item.pos, shift, shift)
  }
  // The copies' positions go in the same history event as the inserted markup, so one ⌘Z undoes
  // both; seed the client's state cache so the copies mount in place.
  const items = Object.entries(positions).map(([dragId, pos]) => ({ dragId, before: null, after: posToSnapshot(pos) }))
  if (initialState.value) {
    const slide = initialState.value[slideNo] ??= {}
    for (const { dragId, after } of items)
      slide[dragId] = after
  }
  await pushTextEdit(slideNo, changedRange(content, next), items)
  const res = await fetch(`/__slidev/slides/${slideNo}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ content: next, skipHmr: false }),
  })
  if (!res.ok)
    throw new Error(`Failed to patch slide ${slideNo} (${res.status})`)
}

export function useCopyPaste() {
  function onKeydown(ev: KeyboardEvent) {
    if (!editMode.value || isInputting.value || !(ev.metaKey || ev.ctrlKey) || ev.shiftKey || ev.altKey || ev.key !== 'c')
      return
    if (getSelection()?.toString() || !getSelectedElements().size)
      return
    ev.preventDefault()
    void copySelected().catch(err => console.error('[Slidev] Copy failed:', err))
  }
  // Paste: only when the clipboard still holds what ⌘C put there; anything else (an image file,
  // a URL) goes on to the other paste handlers.
  function onPaste(ev: ClipboardEvent) {
    if (!editMode.value || isInputting.value || !copied || ev.clipboardData?.getData('text/plain') !== copied.text)
      return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    void paste().catch(err => console.error('[Slidev] Paste failed:', err))
  }
  onMounted(() => {
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('paste', onPaste, true)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('paste', onPaste, true)
  })
}
