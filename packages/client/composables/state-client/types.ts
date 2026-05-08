// Shared shapes for the IStateClient abstraction. Mirrors the server-side types in
// `packages/slidev/node/state/types.ts` so swapping a remote client (dev server) for a
// local one (static demo build) is just a matter of routing: both produce the same
// EditEvent / ElementSnapshot shapes that the drawer + history machinery already consume.

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

export type EditKind = 'move' | 'resize' | 'rotate' | 'crop' | 'zorder' | 'restore' | 'hydrate'

export interface EditItem {
  dragId: string
  before: ElementSnapshot | null
  after: ElementSnapshot | null
}

export interface EditEvent {
  id: number
  ts: number
  slideNo: number
  kind: EditKind
  items: EditItem[]
  undoneAt: number | null
  abandonedAt: number | null
  label: string | null
}

export type AllElementState = Record<string, Record<string, ElementSnapshot>>

export interface ServerSnapshot {
  state: AllElementState
  topActiveEventId: number | null
  lastYamlCommitEventId: number | null
}

export interface AffectedItem {
  slideNo: number
  dragId: string
  state: ElementSnapshot | null
}

export interface UndoRedoResult {
  event: EditEvent
  affected: AffectedItem[]
  topActiveEventId: number | null
}

export interface CommitResult {
  committedEventId: number | null
  dirty: boolean
}

// Notifications emitted by `subscribe()`. The remote client receives these from SSE; the
// local client emits them on every mutation. Identical envelope across both backends.
export interface StateChangeMessage {
  type: 'state-change'
  source: 'edit' | 'undo' | 'redo' | 'restore' | 'yaml-commit'
  topActiveEventId: number | null
  triggeringEventId?: number | null
}

export interface EditOptions {
  slideNo: number
  kind: EditKind
  items: EditItem[]
  label?: string | null
}

export interface ListEventsOptions {
  limit?: number
  sinceId?: number
  slideNo?: number
}

// The single contract every client backend must implement. `useDragHistory` calls these
// methods instead of `fetch()` directly, so swapping `RemoteStateClient` (dev) for
// `LocalStateClient` (static deploy) is transparent to the rest of the app.
export interface IStateClient {
  /** Fetch the current snapshot of element state + bookkeeping ids. */
  getSnapshot: () => Promise<ServerSnapshot>
  /** List events DESC by id, optionally filtered. */
  listEvents: (opts?: ListEventsOptions) => Promise<EditEvent[]>
  /** Insert a new edit event; returns the persisted event with its assigned id. */
  edit: (opts: EditOptions) => Promise<EditEvent>
  /** Undo the top-active event (or a specific one). Returns null if nothing to undo. */
  undo: (eventId?: number) => Promise<UndoRedoResult | null>
  /** Redo the most-recently-undone event. Returns null if nothing to redo. */
  redo: (eventId?: number) => Promise<UndoRedoResult | null>
  /** Restore the slide owning `eventId` to the historical state at that point. */
  restore: (eventId: number) => Promise<EditEvent | null>
  /** Flush element_state → slides.coords.yaml. No-op for non-server backends. */
  commitYaml: () => Promise<CommitResult>
  /** Subscribe to state-change broadcasts. Returns an unsubscribe fn. */
  subscribe: (handler: (msg: StateChangeMessage) => void) => () => void
  /** Tear down any open connections / timers. */
  dispose: () => void
}
