import { useLocalStorage } from '@vueuse/core'
import { computed, nextTick, watch } from 'vue'
import { useNav } from './useNav'

export interface ElementSnapshot {
  x0: number
  y0: number
  width: number
  height: number
  rotate: number
  zIndex: number
  cropTop: number
  cropRight: number
  cropBottom: number
  cropLeft: number
}

export type EditKind = 'move' | 'resize' | 'rotate' | 'crop' | 'zorder'

export interface EditEntry {
  ts: number
  slideNo: number
  kind: EditKind
  items: Array<{ dragId: string, before: ElementSnapshot }>
}

const MAX_ENTRIES = 200
const TTL_MS = 30 * 24 * 60 * 60 * 1000

// Per-deck key. Strip the trailing slide number so the key is stable as the user navigates.
function deckKey(): string {
  if (typeof location === 'undefined')
    return 'slidev-drag-history:'
  const path = location.pathname.replace(/\/\d+\/?$/, '')
  return `slidev-drag-history:${location.origin}${path}`
}

const undoStack = useLocalStorage<EditEntry[]>(`${deckKey()}:undo`, [])
const redoStack = useLocalStorage<EditEntry[]>(`${deckKey()}:redo`, [])

// GC stale entries on first load: drop anything older than TTL, then cap at MAX_ENTRIES.
{
  const now = Date.now()
  const fresh = (e: EditEntry) => now - e.ts < TTL_MS
  if (undoStack.value.some(e => !fresh(e)) || undoStack.value.length > MAX_ENTRIES)
    undoStack.value = undoStack.value.filter(fresh).slice(-MAX_ENTRIES)
  if (redoStack.value.some(e => !fresh(e)) || redoStack.value.length > MAX_ENTRIES)
    redoStack.value = redoStack.value.filter(fresh).slice(-MAX_ENTRIES)
}

export const canUndo = computed(() => undoStack.value.length > 0)
export const canRedo = computed(() => redoStack.value.length > 0)
export const topUndoEntry = computed<EditEntry | null>(() => undoStack.value[undoStack.value.length - 1] ?? null)
export const topRedoEntry = computed<EditEntry | null>(() => redoStack.value[redoStack.value.length - 1] ?? null)

// Registry of mounted drag elements, so global undo/redo can locate the target by `(slideNo, dragId)`.
export interface RegisteredState {
  page: { value: number }
  dragId: string
  capture: () => ElementSnapshot
  apply: (s: ElementSnapshot) => void
}

const registry = new Map<string, RegisteredState>()
const regKey = (slideNo: number, dragId: string) => `${slideNo}:${dragId}`

export function registerHistoryState(state: RegisteredState): void {
  registry.set(regKey(state.page.value, state.dragId), state)
}

export function unregisterHistoryState(state: RegisteredState): void {
  const k = regKey(state.page.value, state.dragId)
  if (registry.get(k) === state)
    registry.delete(k)
}

function trim() {
  if (undoStack.value.length > MAX_ENTRIES)
    undoStack.value = undoStack.value.slice(-MAX_ENTRIES)
  if (redoStack.value.length > MAX_ENTRIES)
    redoStack.value = redoStack.value.slice(-MAX_ENTRIES)
}

// Push a single-element edit. The before-snapshot is captured at call time; the after-state is
// implicit (whatever's on the element when undo eventually runs).
export function pushEdit(slideNo: number, kind: EditKind, dragId: string, before: ElementSnapshot): void {
  undoStack.value.push({ ts: Date.now(), slideNo, kind, items: [{ dragId, before }] })
  redoStack.value = []
  trim()
}

// Push an atomic multi-element edit (e.g. group drag, group rotate).
export function pushGroupEdit(slideNo: number, kind: EditKind, items: Array<{ dragId: string, before: ElementSnapshot }>): void {
  if (items.length === 0)
    return
  undoStack.value.push({ ts: Date.now(), slideNo, kind, items })
  redoStack.value = []
  trim()
}

// Pop the top undo entry without applying or pushing to redo, but only if it matches the
// given (slideNo, dragIds) — `dragIds` is one element for a single-edit, or N for a group.
// Used by abort paths so a pinch- or cancel-aborted drag never shows up in undo/redo.
export function discardTopMatching(slideNo: number, dragIds: string[]): boolean {
  const top = undoStack.value[undoStack.value.length - 1]
  if (!top)
    return false
  if (top.slideNo !== slideNo || top.items.length !== dragIds.length)
    return false
  const topIds = new Set(top.items.map(it => it.dragId))
  if (!dragIds.every(id => topIds.has(id)))
    return false
  undoStack.value.pop()
  return true
}

async function ensureSlide(slideNo: number): Promise<void> {
  const { go, currentSlideNo } = useNav()
  if (currentSlideNo.value === slideNo)
    return
  go(slideNo)
  // Wait for the route change to propagate and for new elements to mount + register.
  await nextTick()
  await new Promise(r => setTimeout(r, 50))
}

async function applyEntry(entry: EditEntry): Promise<EditEntry | null> {
  await ensureSlide(entry.slideNo)
  const inverseItems: EditEntry['items'] = []
  for (const item of entry.items) {
    const state = registry.get(regKey(entry.slideNo, item.dragId))
    if (!state)
      continue
    inverseItems.push({ dragId: item.dragId, before: state.capture() })
    state.apply(item.before)
  }
  if (inverseItems.length === 0)
    return null
  return { ts: Date.now(), slideNo: entry.slideNo, kind: entry.kind, items: inverseItems }
}

export async function undo(): Promise<void> {
  const entry = undoStack.value[undoStack.value.length - 1]
  if (!entry)
    return
  undoStack.value.pop()
  const inverse = await applyEntry(entry)
  if (inverse) {
    redoStack.value.push(inverse)
    trim()
  }
}

export async function redo(): Promise<void> {
  const entry = redoStack.value[redoStack.value.length - 1]
  if (!entry)
    return
  redoStack.value.pop()
  const inverse = await applyEntry(entry)
  if (inverse) {
    undoStack.value.push(inverse)
    trim()
  }
}

const KIND_LABEL: Record<EditKind, string> = {
  move: 'move',
  resize: 'resize',
  rotate: 'rotation',
  crop: 'crop',
  zorder: 'z-order change',
}

// Human-readable description of a stack-top entry, for tooltips like
// "Undo move of demo-card-a on slide 3".
export function describeEntry(entry: EditEntry | null): string {
  if (!entry)
    return ''
  const what = KIND_LABEL[entry.kind] ?? entry.kind
  const target = entry.items.length === 1
    ? `\`${entry.items[0].dragId}\``
    : `${entry.items.length} elements`
  return `${what} of ${target} on slide ${entry.slideNo}`
}

// Cross-tab sync: useLocalStorage already syncs on `storage` events, but it doesn't fire
// reactivity for changes the same tab made elsewhere (e.g. via direct localStorage.setItem).
// We don't need that here — same-tab writes go through this module's refs.
void watch
