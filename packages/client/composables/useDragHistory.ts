import { computed, ref } from 'vue'
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

export interface EditItem {
  dragId: string
  before: ElementSnapshot | null
  after: ElementSnapshot | null
}

export interface EditEvent {
  id: number
  ts: number
  slideNo: number
  kind: EditKind | 'restore' | 'hydrate'
  items: EditItem[]
  undoneAt: number | null
  abandonedAt: number | null
  label: string | null
}

interface AffectedItem {
  slideNo: number
  dragId: string
  state: ElementSnapshot | null
}

interface ServerSnapshot {
  state: Record<string, Record<string, ElementSnapshot>>
  topActiveEventId: number | null
  lastYamlCommitEventId: number | null
}

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

// Server-side derived state (cached on the client). Kept in sync via every API response.
export const topActiveEventId = ref<number | null>(null)
export const lastYamlCommitEventId = ref<number | null>(null)
const topActiveEvent = ref<EditEvent | null>(null)
const topRedoableEvent = ref<EditEvent | null>(null)
// Server-derived element state, populated on cold-start hydration. Lets useDragElement
// override frontmatter.dragPos when the DB has fresher values than the YAML snapshot.
export const initialState = ref<Record<string, Record<string, ElementSnapshot>> | null>(null)

export const canUndo = computed(() => topActiveEvent.value !== null)
export const canRedo = computed(() => topRedoableEvent.value !== null)
export const topUndoEntry = computed<EditEvent | null>(() => topActiveEvent.value)
export const topRedoEntry = computed<EditEvent | null>(() => topRedoableEvent.value)
export const isDirty = computed(() => {
  const top = topActiveEventId.value
  const committed = lastYamlCommitEventId.value
  if (top === null)
    return false
  return committed === null || top > committed
})

// Re-fetch the top-active + top-redoable events from the server. Also refreshes
// `topActiveEventId` and the YAML commit watermark so the dirty indicator stays accurate.
// Useful when something other than this client (e.g. raw curl, the drawer) may have
// changed server state.
export async function refreshHistoryState(): Promise<void> {
  const [snap, eventsResp] = await Promise.all([
    fetch('/__slidev/state').then(r => r.json()) as Promise<ServerSnapshot>,
    fetch('/__slidev/state/events?limit=20').then(r => r.json()) as Promise<{ events: EditEvent[] }>,
  ])
  topActiveEventId.value = snap.topActiveEventId
  lastYamlCommitEventId.value = snap.lastYamlCommitEventId
  topActiveEvent.value = eventsResp.events.find(e => e.undoneAt === null && e.abandonedAt === null) ?? null
  topRedoableEvent.value = eventsResp.events.find(e => e.undoneAt !== null && e.abandonedAt === null) ?? null
}
const fetchTopEvents = refreshHistoryState

// Bumped after every edit/undo/redo/restore so the version-history drawer can refetch.
export const eventStreamVersion = ref(0)
function bumpEventStream(): void {
  eventStreamVersion.value += 1
}

// Fetch a page of events for the drawer. `limit` defaults to 200 (covers most decks
// without paging); callers can paginate with `sinceId` if they need more.
export async function fetchEvents(opts: { limit?: number, sinceId?: number, slideNo?: number } = {}): Promise<EditEvent[]> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined)
    params.set('limit', String(opts.limit))
  if (opts.sinceId !== undefined)
    params.set('since', String(opts.sinceId))
  if (opts.slideNo !== undefined)
    params.set('slide', String(opts.slideNo))
  const resp = await fetch(`/__slidev/state/events?${params}`)
  const { events } = await resp.json() as { events: EditEvent[] }
  return events
}

// Restore the slide owning `eventId` to its state at that point. Inserts a `kind='restore'`
// event server-side; the affected element_state is recomputed and the response includes the
// new event so the client can update topActive + apply changes locally.
export async function restoreToEvent(eventId: number): Promise<EditEvent | null> {
  const resp = await fetch('/__slidev/state/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId }),
  })
  const data = await resp.json() as { event: EditEvent | null }
  if (data.event) {
    topActiveEventId.value = data.event.id
    topActiveEvent.value = data.event
    topRedoableEvent.value = null
    // Apply the restore directly to live elements via the registry so the UI updates.
    await ensureSlide(data.event.slideNo)
    for (const item of data.event.items) {
      if (item.after === null)
        continue
      const state = registry.get(regKey(data.event.slideNo, item.dragId))
      if (state)
        state.apply(item.after)
    }
    bumpEventStream()
  }
  return data.event
}

let hydratePromise: Promise<void> | null = null
export function hydrateFromServer(): Promise<void> {
  if (hydratePromise)
    return hydratePromise
  hydratePromise = (async () => {
    const resp = await fetch('/__slidev/state')
    const snap = await resp.json() as ServerSnapshot
    initialState.value = snap.state
    topActiveEventId.value = snap.topActiveEventId
    lastYamlCommitEventId.value = snap.lastYamlCommitEventId
    await fetchTopEvents()
  })()
  return hydratePromise
}

// A single-element pending edit. The element's `before` is captured at beginEdit time;
// `after` is captured at commit time (live state).
interface PendingEdit {
  slideNo: number
  kind: EditKind
  before: ElementSnapshot
  capture: () => ElementSnapshot
}

const pendingByKey = new Map<string, PendingEdit>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const COMMIT_DEBOUNCE_MS = 150

function clearPending(slideNo: number, dragId: string): void {
  const k = regKey(slideNo, dragId)
  pendingByKey.delete(k)
  const t = debounceTimers.get(k)
  if (t) {
    clearTimeout(t)
    debounceTimers.delete(k)
  }
}

async function postEdit(slideNo: number, kind: EditKind, items: EditItem[]): Promise<void> {
  const resp = await fetch('/__slidev/state/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slideNo, kind, items }),
  })
  const data = await resp.json() as { event: EditEvent }
  topActiveEventId.value = data.event.id
  topActiveEvent.value = data.event
  topRedoableEvent.value = null
  bumpEventStream()
}

// Mark the start of an edit on a single element. Captures `before` from `state.capture()`.
// Subsequent calls before commit replace the pending edit (the `before` is the snapshot at
// the start of the *outermost* edit, not the latest threshold-cross).
export function beginEdit(state: RegisteredState, kind: EditKind): void {
  const k = regKey(state.page.value, state.dragId)
  if (pendingByKey.has(k))
    return // keep the original `before`; just merge into ongoing edit
  pendingByKey.set(k, {
    slideNo: state.page.value,
    kind,
    before: state.capture(),
    capture: state.capture,
  })
}

// Schedule an idle-commit for a pending edit. Called from the position watcher in
// useDragElement on every change. After COMMIT_DEBOUNCE_MS of quiescence, capture `after`
// and POST.
export function bumpEditCommit(state: RegisteredState): void {
  const k = regKey(state.page.value, state.dragId)
  if (!pendingByKey.has(k))
    return
  const t = debounceTimers.get(k)
  if (t)
    clearTimeout(t)
  debounceTimers.set(k, setTimeout(() => commitEdit(state), COMMIT_DEBOUNCE_MS))
}

// Force-commit a pending edit immediately (e.g. before navigating, before undo).
export async function commitEdit(state: RegisteredState): Promise<void> {
  const k = regKey(state.page.value, state.dragId)
  const pending = pendingByKey.get(k)
  if (!pending)
    return
  clearPending(pending.slideNo, state.dragId)
  const after = pending.capture()
  await postEdit(pending.slideNo, pending.kind, [{ dragId: state.dragId, before: pending.before, after }])
}

// Drop a pending edit without POSTing (abort path).
export function discardEdit(state: RegisteredState): void {
  clearPending(state.page.value, state.dragId)
}

// One-shot atomic edits where both `before` and `after` are known up front (e.g. z-order
// reordering). No debounce, no pending state.
export async function pushEdit(slideNo: number, kind: EditKind, dragId: string, before: ElementSnapshot, after: ElementSnapshot): Promise<void> {
  await postEdit(slideNo, kind, [{ dragId, before, after }])
}

// Multi-element atomic edit. `items` carries before+after for each element.
export async function pushGroupEdit(slideNo: number, kind: EditKind, items: Array<{ dragId: string, before: ElementSnapshot, after: ElementSnapshot }>): Promise<void> {
  if (items.length === 0)
    return
  await postEdit(slideNo, kind, items.map(i => ({ dragId: i.dragId, before: i.before, after: i.after })))
}

// Like pushEdit but for callers that have only `before` and rely on the registry's live
// state to capture `after` immediately. Used by callers that change values then call this
// (e.g. zorder buttons in DragControl).
export async function pushEditNow(slideNo: number, kind: EditKind, dragId: string, before: ElementSnapshot): Promise<void> {
  const state = registry.get(regKey(slideNo, dragId))
  if (!state)
    return
  await pushEdit(slideNo, kind, dragId, before, state.capture())
}

export async function pushGroupEditNow(slideNo: number, kind: EditKind, items: Array<{ dragId: string, before: ElementSnapshot }>): Promise<void> {
  const filled: Array<{ dragId: string, before: ElementSnapshot, after: ElementSnapshot }> = []
  for (const it of items) {
    const state = registry.get(regKey(slideNo, it.dragId))
    if (!state)
      continue
    filled.push({ ...it, after: state.capture() })
  }
  await pushGroupEdit(slideNo, kind, filled)
}

// Discard the topmost pending edits matching this set of drag ids (abort path for
// in-flight drags that may have already crossed the threshold).
export function discardTopMatching(slideNo: number, dragIds: string[]): boolean {
  for (const id of dragIds)
    clearPending(slideNo, id)
  return true
}

async function ensureSlide(slideNo: number): Promise<void> {
  const { go, currentSlideNo } = useNav()
  if (currentSlideNo.value === slideNo)
    return
  go(slideNo)
  await new Promise(r => setTimeout(r, 80))
}

function applyAffected(items: AffectedItem[]): void {
  for (const it of items) {
    if (it.state === null)
      continue
    const state = registry.get(regKey(it.slideNo, it.dragId))
    if (state)
      state.apply(it.state)
  }
}

export async function undo(): Promise<void> {
  const target = topActiveEvent.value
  if (!target)
    return
  await ensureSlide(target.slideNo)
  const resp = await fetch('/__slidev/state/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const data = await resp.json() as { event: EditEvent | null, affected: AffectedItem[], topActiveEventId: number | null }
  if (!data.event)
    return
  applyAffected(data.affected)
  topActiveEventId.value = data.topActiveEventId
  await fetchTopEvents()
  bumpEventStream()
}

export async function redo(): Promise<void> {
  const target = topRedoableEvent.value
  if (!target)
    return
  await ensureSlide(target.slideNo)
  const resp = await fetch('/__slidev/state/redo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const data = await resp.json() as { event: EditEvent | null, affected: AffectedItem[], topActiveEventId: number | null }
  if (!data.event)
    return
  applyAffected(data.affected)
  topActiveEventId.value = data.topActiveEventId
  await fetchTopEvents()
  bumpEventStream()
}

export async function commitToYaml(): Promise<{ committedEventId: number | null }> {
  const resp = await fetch('/__slidev/state/commit-yaml', { method: 'POST' })
  const data = await resp.json() as { committedEventId: number | null, dirty: boolean }
  lastYamlCommitEventId.value = data.committedEventId
  return data
}

const KIND_LABEL: Record<string, string> = {
  move: 'move',
  resize: 'resize',
  rotate: 'rotation',
  crop: 'crop',
  zorder: 'z-order change',
  hydrate: 'hydrate',
  restore: 'restore',
}

export function describeEntry(entry: EditEvent | null): string {
  if (!entry)
    return ''
  const what = KIND_LABEL[entry.kind] ?? entry.kind
  const target = entry.items.length === 1
    ? `\`${entry.items[0].dragId}\``
    : `${entry.items.length} elements`
  return `${what} of ${target} on slide ${entry.slideNo}`
}
