import type {
  EditKind as ClientEditKind,
  EditItem,
  ElementSnapshot,
  EditEvent as Event,
  IStateClient,
  ListEventsOptions,
} from './state-client'
import { computed, ref } from 'vue'
import { getStateClient } from './state-client'
import { useNav } from './useNav'

// Re-export the canonical types so existing consumers (HistoryDrawer.vue, etc.) keep
// importing them from `useDragHistory` and don't need to change.
export type {
  AffectedItem,
  EditEvent,
  EditItem,
  ElementSnapshot,
  EditKind as InternalEditKind,
} from './state-client'

// External callers (VDrag, DragControl, GroupDragControl) use the narrow set of edit
// kinds — restore/hydrate are internal-only and produced by the client backends, never
// pushed by UI code. Keeps our public API expressive while letting the IStateClient layer
// handle every kind uniformly.
export type EditKind = 'move' | 'resize' | 'rotate' | 'crop' | 'zorder'

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

// Cached client-side mirror of the IStateClient's bookkeeping. Kept fresh by every
// mutation response and by the SSE-or-storage subscriber.
export const topActiveEventId = ref<number | null>(null)
export const lastYamlCommitEventId = ref<number | null>(null)
const topActiveEvent = ref<Event | null>(null)
const topRedoableEvent = ref<Event | null>(null)
// Server-derived element state, populated on cold-start hydration. Lets useDragElement
// override frontmatter.dragPos when the DB has fresher values than the YAML snapshot.
export const initialState = ref<Record<string, Record<string, ElementSnapshot>> | null>(null)

export const canUndo = computed(() => topActiveEvent.value !== null)
export const canRedo = computed(() => topRedoableEvent.value !== null)
export const topUndoEntry = computed<Event | null>(() => topActiveEvent.value)
export const topRedoEntry = computed<Event | null>(() => topRedoableEvent.value)
export const isDirty = computed(() => {
  const top = topActiveEventId.value
  const committed = lastYamlCommitEventId.value
  if (top === null)
    return false
  return committed === null || top > committed
})

// Re-fetch the top-active + top-redoable events. Useful when something other than this
// client (another tab via storage event / SSE, raw curl, the drawer's manual refresh)
// may have changed state under us.
export async function refreshHistoryState(): Promise<void> {
  const client = await getStateClient()
  const [snap, events] = await Promise.all([
    client.getSnapshot(),
    client.listEvents({ limit: 20 }),
  ])
  topActiveEventId.value = snap.topActiveEventId
  lastYamlCommitEventId.value = snap.lastYamlCommitEventId
  topActiveEvent.value = events.find(e => e.undoneAt === null && e.abandonedAt === null) ?? null
  topRedoableEvent.value = events.find(e => e.undoneAt !== null && e.abandonedAt === null) ?? null
}
const fetchTopEvents = refreshHistoryState

// Bumped after every edit/undo/redo/restore so the version-history drawer can refetch.
export const eventStreamVersion = ref(0)
function bumpEventStream(): void {
  eventStreamVersion.value += 1
}

export async function fetchEvents(opts: ListEventsOptions = {}): Promise<Event[]> {
  const client = await getStateClient()
  return client.listEvents(opts)
}

// Restore the slide owning `eventId` to its state at that point. The IStateClient inserts
// a `kind='restore'` event whose payload pairs `(before=current, after=historical)` per
// element; we then apply those `after` snapshots to live elements via the registry so the
// UI updates instantly.
export async function restoreToEvent(eventId: number): Promise<Event | null> {
  const client = await getStateClient()
  const event = await client.restore(eventId)
  if (event) {
    topActiveEventId.value = event.id
    topActiveEvent.value = event
    topRedoableEvent.value = null
    await ensureSlide(event.slideNo)
    for (const item of event.items) {
      if (item.after === null)
        continue
      const state = registry.get(regKey(event.slideNo, item.dragId))
      if (state)
        state.apply(item.after)
    }
    bumpEventStream()
  }
  return event
}

let hydratePromise: Promise<void> | null = null
export function hydrateFromServer(): Promise<void> {
  if (hydratePromise)
    return hydratePromise
  hydratePromise = (async () => {
    const client = await getStateClient()
    const snap = await client.getSnapshot()
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
  kind: ClientEditKind
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

// On first edit when there's no event log yet (static-deploy / fresh-DB), synthesize a
// `kind='hydrate'` event capturing the current slide's registered elements. Without this,
// `restoreToEvent(<first event>)` would diff current ↔ current and return null, leaving
// the user with no rollback target. Mirrors the dev-server's `hydrateIfEmpty` cold-start
// behavior, scoped to the current slide since we only know about mounted elements.
async function synthesizeHydrateIfEmpty(client: IStateClient, slideNo: number): Promise<void> {
  if (topActiveEventId.value !== null)
    return
  const items: EditItem[] = []
  for (const [k, state] of registry) {
    const [slideStr, dragId] = k.split(':')
    if (Number(slideStr) !== slideNo)
      continue
    items.push({ dragId, before: null, after: state.capture() })
  }
  if (items.length === 0)
    return
  const event = await client.edit({
    slideNo,
    kind: 'hydrate' as ClientEditKind,
    items,
    label: 'hydrate-from-frontmatter',
  })
  topActiveEventId.value = event.id
  topActiveEvent.value = event
}

async function postEdit(slideNo: number, kind: ClientEditKind, items: EditItem[]): Promise<void> {
  const client = await getStateClient()
  await synthesizeHydrateIfEmpty(client, slideNo)
  const event = await client.edit({ slideNo, kind, items })
  topActiveEventId.value = event.id
  topActiveEvent.value = event
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

export function bumpEditCommit(state: RegisteredState): void {
  const k = regKey(state.page.value, state.dragId)
  if (!pendingByKey.has(k))
    return
  const t = debounceTimers.get(k)
  if (t)
    clearTimeout(t)
  debounceTimers.set(k, setTimeout(commitEdit, COMMIT_DEBOUNCE_MS, state))
}

export async function commitEdit(state: RegisteredState): Promise<void> {
  const k = regKey(state.page.value, state.dragId)
  const pending = pendingByKey.get(k)
  if (!pending)
    return
  clearPending(pending.slideNo, state.dragId)
  const after = pending.capture()
  await postEdit(pending.slideNo, pending.kind, [{ dragId: state.dragId, before: pending.before, after }])
}

export function discardEdit(state: RegisteredState): void {
  clearPending(state.page.value, state.dragId)
}

export async function pushEdit(slideNo: number, kind: EditKind, dragId: string, before: ElementSnapshot, after: ElementSnapshot): Promise<void> {
  await postEdit(slideNo, kind, [{ dragId, before, after }])
}

export async function pushGroupEdit(slideNo: number, kind: EditKind, items: Array<{ dragId: string, before: ElementSnapshot, after: ElementSnapshot }>): Promise<void> {
  if (items.length === 0)
    return
  await postEdit(slideNo, kind, items.map(i => ({ dragId: i.dragId, before: i.before, after: i.after })))
}

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

export function discardTopMatching(slideNo: number, dragIds: string[]): boolean {
  for (const id of dragIds)
    clearPending(slideNo, id)
  return true
}

// Re-fetch full state from the client and re-apply to all registered elements (skipping
// any element this tab is mid-edit on, so we don't clobber an in-progress drag with a
// stale snapshot).
async function syncFromClient(): Promise<void> {
  const client = await getStateClient()
  const snap = await client.getSnapshot()
  topActiveEventId.value = snap.topActiveEventId
  lastYamlCommitEventId.value = snap.lastYamlCommitEventId
  initialState.value = snap.state
  await fetchTopEvents()
  for (const [slideKey, byId] of Object.entries(snap.state)) {
    const slideNo = Number(slideKey)
    for (const [dragId, snapshot] of Object.entries(byId)) {
      const k = regKey(slideNo, dragId)
      if (pendingByKey.has(k))
        continue
      registry.get(k)?.apply(snapshot)
    }
  }
  bumpEventStream()
}

let unsubscribeStream: (() => void) | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSync(): void {
  if (syncTimer)
    clearTimeout(syncTimer)
  // Tail-debounce: rapid bursts (another tab dragging a group of N elements emits N
  // broadcasts in flight) collapse into a single re-fetch + re-apply.
  syncTimer = setTimeout(() => {
    syncTimer = null
    void syncFromClient()
  }, 50)
}

// Subscribe to state-change broadcasts (SSE in dev, `storage` events in static mode).
// Idempotent — the subscription is keyed off this module's `unsubscribeStream`.
export async function connectStateStream(): Promise<void> {
  if (unsubscribeStream)
    return
  const client = await getStateClient()
  unsubscribeStream = client.subscribe((msg) => {
    // Self-origin dedup: when this tab triggered the change, our local topActiveEventId
    // already matches the broadcast id. yaml-commit doesn't move topActive, so handle it
    // unconditionally (the bookmark/dirty indicators need refresh).
    if (msg.source !== 'yaml-commit' && msg.topActiveEventId === topActiveEventId.value)
      return
    scheduleSync()
  })
}

// HMR-safe cleanup: when Vite hot-reloads this module, the new instance starts fresh and
// would open a new EventSource — but the old EventSource keeps its TCP/SSE connection open
// (JS GC won't tear down active network connections), so without this every HMR cycle adds
// a lingering subscriber.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeStream?.()
    unsubscribeStream = null
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
  })
}

async function ensureSlide(slideNo: number): Promise<void> {
  const { go, currentSlideNo } = useNav()
  if (currentSlideNo.value === slideNo)
    return
  go(slideNo)
  await new Promise(r => setTimeout(r, 80))
}

function applyAffected(items: Array<{ slideNo: number, dragId: string, state: ElementSnapshot | null }>): void {
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
  const client = await getStateClient()
  const result = await client.undo()
  if (!result)
    return
  applyAffected(result.affected)
  topActiveEventId.value = result.topActiveEventId
  await fetchTopEvents()
  bumpEventStream()
}

export async function redo(): Promise<void> {
  const target = topRedoableEvent.value
  if (!target)
    return
  await ensureSlide(target.slideNo)
  const client = await getStateClient()
  const result = await client.redo()
  if (!result)
    return
  applyAffected(result.affected)
  topActiveEventId.value = result.topActiveEventId
  await fetchTopEvents()
  bumpEventStream()
}

export async function commitToYaml(): Promise<{ committedEventId: number | null }> {
  const client = await getStateClient()
  const result = await client.commitYaml()
  lastYamlCommitEventId.value = result.committedEventId
  return result
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

export function describeEntry(entry: Event | null): string {
  if (!entry)
    return ''
  const what = KIND_LABEL[entry.kind] ?? entry.kind
  const target = entry.items.length === 1
    ? `\`${entry.items[0].dragId}\``
    : `${entry.items.length} elements`
  return `${what} of ${target} on slide ${entry.slideNo}`
}
