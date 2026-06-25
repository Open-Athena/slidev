// Shared shapes between dev-server state module and the client. Keep in sync with
// `packages/client/composables/useDragHistory.ts`.

export type EditKind = 'move' | 'resize' | 'rotate' | 'crop' | 'zorder' | 'restore' | 'hydrate' | 'delete'

/**
 * Source-line splice metadata for `delete` events. The server records the
 * removed slide-content lines + their line range so undo can re-insert them.
 * The slide source mutation itself is performed via the existing
 * `/__slidev/slides/<n>.json` POST (not via this struct); this only stores what
 * to put back. Redo re-removes the same range.
 */
export interface DeleteSourceContext {
  lineRange: [start: number, end: number]
  lines: string[]
}

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
  /** Present only for `kind: 'delete'` events; tells undo what source lines to put back. */
  source?: DeleteSourceContext
}

// `{[slideNo]: {[dragId]: ElementSnapshot}}`
export type AllElementState = Record<string, Record<string, ElementSnapshot>>

export interface CommitResult {
  committedEventId: number | null
  dirty: boolean
}

export interface StateSnapshot {
  state: AllElementState
  topActiveEventId: number | null
  lastYamlCommitEventId: number | null
}
