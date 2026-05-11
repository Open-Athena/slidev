// localStorage-backed event log that mirrors the dev-server's SQLite backend. Used in
// static-deploy demos where there's no `/__slidev/state/*` endpoint to talk to. Edits
// persist for the visitor's session (and across reloads / tabs on the same origin via
// the `storage` event), but never escape the browser.
//
// Storage layout (one origin can host multiple decks at different paths):
//   slidev-state:<key>:events  → JSON array of EditEvent (capped, FIFO eviction)
//   slidev-state:<key>:meta    → JSON { lastYamlCommitEventId, nextEventId }
//   slidev-state:<key>:tick    → ever-incrementing counter; cross-tab notification trigger
//
// Bookkeeping that derives from the event log (topActiveEventId, topRedoableEventId,
// element_state) is computed on demand rather than stored, matching the server's
// "events table is truth, element_state is cache" model — except here we recompute every
// time, which is fine at the 1000-event cap.

import type {
  AffectedItem,
  AllElementState,
  CommitResult,
  EditEvent,
  EditItem,
  EditOptions,
  ElementSnapshot,
  IStateClient,
  ListEventsOptions,
  ServerSnapshot,
  StateChangeMessage,
  UndoRedoResult,
} from './types'

// FIFO cap: 500 KB worth of events at typical ~500 bytes each fits easily in any browser's
// localStorage budget (which is ~5–10 MB per origin). Bump if anyone ever hits it; the
// trigger to switch backends to IndexedDB is a real complaint, not a guess.
const EVENT_CAP = 1000

interface MetaRow {
  lastYamlCommitEventId: number | null
  nextEventId: number
}

function defaultMeta(): MetaRow {
  return { lastYamlCommitEventId: null, nextEventId: 1 }
}

export class LocalStateClient implements IStateClient {
  private subscribers = new Set<(msg: StateChangeMessage) => void>()
  private storageHandler: ((ev: StorageEvent) => void) | null = null

  // Storage keys (one prefix per deck path so multiple decks on the same origin don't
  // clobber each other's history). Pathname-derived; falls back to the literal "default"
  // when running in environments without a meaningful URL (SSR, tests).
  private readonly key: string
  private readonly eventsKey: string
  private readonly metaKey: string
  private readonly tickKey: string

  constructor(deckKey?: string) {
    const k = deckKey ?? (typeof location !== 'undefined' ? location.pathname.replace(/[/?#].*$/, '') || 'root' : 'default')
    this.key = `slidev-state:${k}`
    this.eventsKey = `${this.key}:events`
    this.metaKey = `${this.key}:meta`
    this.tickKey = `${this.key}:tick`
    this.attachStorageListener()
  }

  // ─── Persistence helpers ───────────────────────────────────────────────────

  private readEvents(): EditEvent[] {
    if (typeof localStorage === 'undefined')
      return []
    try {
      const raw = localStorage.getItem(this.eventsKey)
      if (!raw)
        return []
      return JSON.parse(raw) as EditEvent[]
    }
    catch {
      return []
    }
  }

  private writeEvents(events: EditEvent[]): void {
    if (typeof localStorage === 'undefined')
      return
    // FIFO eviction at the cap. Since events are stored chronologically (ASC by id), the
    // oldest live at the front of the array.
    const trimmed = events.length > EVENT_CAP ? events.slice(events.length - EVENT_CAP) : events
    try {
      localStorage.setItem(this.eventsKey, JSON.stringify(trimmed))
    }
    catch (err) {
      // QuotaExceeded — the cap should prevent this, but if a single event is huge, drop
      // older history aggressively and retry once. Not catching this here would corrupt
      // the visitor's working state.
      console.warn('[slidev:state-local] localStorage quota exceeded, dropping older events', err)
      const halved = trimmed.slice(Math.floor(trimmed.length / 2))
      try {
        localStorage.setItem(this.eventsKey, JSON.stringify(halved))
      }
      catch {
        // Give up; the visitor's session will be inconsistent but the app stays alive.
      }
    }
  }

  private readMeta(): MetaRow {
    if (typeof localStorage === 'undefined')
      return defaultMeta()
    try {
      const raw = localStorage.getItem(this.metaKey)
      return raw ? { ...defaultMeta(), ...JSON.parse(raw) } : defaultMeta()
    }
    catch {
      return defaultMeta()
    }
  }

  private writeMeta(meta: MetaRow): void {
    if (typeof localStorage === 'undefined')
      return
    localStorage.setItem(this.metaKey, JSON.stringify(meta))
  }

  // Bump the cross-tab notification key. Other tabs' `storage` listeners fire and reload
  // their state. The value is ignored by listeners; only the *change* matters.
  private notifyOtherTabs(): void {
    if (typeof localStorage === 'undefined')
      return
    localStorage.setItem(this.tickKey, String(Date.now()))
  }

  private attachStorageListener(): void {
    if (typeof window === 'undefined')
      return
    this.storageHandler = (ev: StorageEvent) => {
      // Only react to our own keys, and only when the value actually changed (some
      // browsers fire storage events for same-tab writes too — `key === null` means
      // localStorage.clear(), which we'll treat as a reset).
      if (ev.key !== this.tickKey && ev.key !== this.eventsKey && ev.key !== null)
        return
      if (this.subscribers.size === 0)
        return
      // We don't have the originating message envelope, so synthesize one. The `useDragHistory`
      // syncFromServer path doesn't depend on the source field beyond logging.
      const msg: StateChangeMessage = {
        type: 'state-change',
        source: 'edit',
        topActiveEventId: this.computeTopActiveId(),
      }
      for (const fn of this.subscribers) fn(msg)
    }
    window.addEventListener('storage', this.storageHandler)
  }

  // ─── Derived state (recomputed, not stored) ────────────────────────────────

  private computeTopActiveId(): number | null {
    const events = this.readEvents()
    let top: number | null = null
    for (const e of events) {
      if (e.undoneAt === null && e.abandonedAt === null && (top === null || e.id > top))
        top = e.id
    }
    return top
  }

  // "Most recently undone" — matches the server's `ORDER BY undone_at DESC, id ASC LIMIT 1`
  // semantic so redo pops in true reverse-undo (LIFO) order.
  private computeTopRedoableId(): number | null {
    const events = this.readEvents()
    let best: { id: number, ts: number } | null = null
    for (const e of events) {
      if (e.undoneAt === null || e.abandonedAt !== null)
        continue
      if (
        best === null
        || e.undoneAt > best.ts
        || (e.undoneAt === best.ts && e.id < best.id)
      ) {
        best = { id: e.id, ts: e.undoneAt }
      }
    }
    return best?.id ?? null
  }

  // Replay every active event, materializing the per-element snapshot map. Mirrors the
  // server's `element_state` table.
  private computeAllState(): AllElementState {
    const events = this.readEvents()
    const out: AllElementState = {}
    for (const e of events) {
      if (e.undoneAt !== null || e.abandonedAt !== null)
        continue
      const slideKey = String(e.slideNo)
      const byId = (out[slideKey] ??= {})
      for (const item of e.items) {
        if (item.after === null)
          delete byId[item.dragId]
        else
          byId[item.dragId] = item.after
      }
    }
    return out
  }

  // ─── IStateClient ──────────────────────────────────────────────────────────

  async getSnapshot(): Promise<ServerSnapshot> {
    return {
      state: this.computeAllState(),
      topActiveEventId: this.computeTopActiveId(),
      lastYamlCommitEventId: this.readMeta().lastYamlCommitEventId,
    }
  }

  async listEvents(opts: ListEventsOptions = {}): Promise<EditEvent[]> {
    const events = this.readEvents()
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000)
    let filtered = events
    if (opts.slideNo !== undefined)
      filtered = filtered.filter(e => e.slideNo === opts.slideNo)
    if (opts.sinceId !== undefined)
      filtered = filtered.filter(e => e.id > opts.sinceId!)
    // Server returns DESC by id. Slice the tail (newest), then reverse.
    const tail = filtered.slice(-limit).reverse()
    return tail
  }

  async edit(opts: EditOptions): Promise<EditEvent> {
    const meta = this.readMeta()
    const events = this.readEvents()
    const ts = Date.now()
    // Abandon all currently-undone events (the redo cliff). Mirrors the server's
    // `UPDATE events SET abandoned_at = ? WHERE undone_at IS NOT NULL AND abandoned_at IS NULL`.
    for (const e of events) {
      if (e.undoneAt !== null && e.abandonedAt === null)
        e.abandonedAt = ts
    }
    const event: EditEvent = {
      id: meta.nextEventId,
      ts,
      slideNo: opts.slideNo,
      kind: opts.kind,
      items: opts.items,
      undoneAt: null,
      abandonedAt: null,
      label: opts.label ?? null,
    }
    events.push(event)
    this.writeEvents(events)
    this.writeMeta({ ...meta, nextEventId: meta.nextEventId + 1 })
    this.notifyOtherTabs()
    this.broadcast({ type: 'state-change', source: 'edit', topActiveEventId: event.id, triggeringEventId: event.id })
    return event
  }

  async undo(eventId?: number): Promise<UndoRedoResult | null> {
    const events = this.readEvents()
    const id = eventId ?? this.computeTopActiveId()
    if (id === null)
      return null
    const event = events.find(e => e.id === id)
    if (!event || event.undoneAt !== null || event.abandonedAt !== null)
      return null
    event.undoneAt = Date.now()
    this.writeEvents(events)
    const result: UndoRedoResult = {
      event,
      affected: this.affectedSubsetForEvent(event),
      topActiveEventId: this.computeTopActiveId(),
    }
    this.notifyOtherTabs()
    this.broadcast({ type: 'state-change', source: 'undo', topActiveEventId: result.topActiveEventId, triggeringEventId: event.id })
    return result
  }

  async redo(eventId?: number): Promise<UndoRedoResult | null> {
    const events = this.readEvents()
    const id = eventId ?? this.computeTopRedoableId()
    if (id === null)
      return null
    const event = events.find(e => e.id === id)
    if (!event || event.undoneAt === null || event.abandonedAt !== null)
      return null
    event.undoneAt = null
    this.writeEvents(events)
    const result: UndoRedoResult = {
      event,
      affected: this.affectedSubsetForEvent(event),
      topActiveEventId: this.computeTopActiveId(),
    }
    this.notifyOtherTabs()
    this.broadcast({ type: 'state-change', source: 'redo', topActiveEventId: result.topActiveEventId, triggeringEventId: event.id })
    return result
  }

  async restore(eventId: number): Promise<EditEvent | null> {
    const events = this.readEvents()
    const target = events.find(e => e.id === eventId)
    if (!target)
      return null
    const slideNo = target.slideNo

    // Walk all non-abandoned events on this slide with id <= target in id order, replaying
    // their `after` snapshots. This builds the historical state at that point in time.
    const historical = new Map<string, ElementSnapshot | null>()
    for (const e of events) {
      if (e.id > eventId || e.slideNo !== slideNo || e.abandonedAt !== null)
        continue
      for (const item of e.items)
        historical.set(item.dragId, item.after)
    }

    // Diff against current state for this slide.
    const current = this.computeAllState()[String(slideNo)] ?? {}
    const allKeys = new Set<string>([...historical.keys(), ...Object.keys(current)])
    const items: EditItem[] = []
    for (const dragId of allKeys) {
      const before = current[dragId] ?? null
      const after = historical.get(dragId) ?? null
      if (snapshotsEqual(before, after))
        continue
      items.push({ dragId, before, after })
    }
    if (items.length === 0)
      return null

    const event = await this.edit({
      slideNo,
      kind: 'restore',
      items,
      label: `restore-to-${eventId}`,
    })
    // edit() already broadcast/notified with `source: 'edit'`; layer a `restore` notification
    // on top so subscribers that branch on source see the right value.
    this.broadcast({ type: 'state-change', source: 'restore', topActiveEventId: event.id, triggeringEventId: event.id })
    return event
  }

  async commitYaml(): Promise<CommitResult> {
    // No filesystem in static mode. Record the current top-active id as the "commit
    // watermark" so the dirty indicator goes idle, mirroring the dev-server semantics
    // even though no actual YAML write happens.
    const meta = this.readMeta()
    const top = this.computeTopActiveId()
    this.writeMeta({ ...meta, lastYamlCommitEventId: top })
    this.broadcast({ type: 'state-change', source: 'yaml-commit', topActiveEventId: top })
    return { committedEventId: top, dirty: false }
  }

  async revertToYaml(): Promise<EditEvent | null> {
    // No bundled-yaml source-of-truth at runtime in static mode: the only way to "revert"
    // is to drop everything and let the elements re-mount from their frontmatter/yaml-
    // baked initial positions. We clear the event log + meta and let the registry's live
    // values become the new ground truth on next interaction.
    this.writeEvents([])
    this.writeMeta({ lastEventId: 0, lastYamlCommitEventId: null })
    this.broadcast({ type: 'state-change', source: 'revert-to-yaml', topActiveEventId: null })
    return null
  }

  subscribe(handler: (msg: StateChangeMessage) => void): () => void {
    this.subscribers.add(handler)
    return () => {
      this.subscribers.delete(handler)
    }
  }

  dispose(): void {
    if (this.storageHandler && typeof window !== 'undefined')
      window.removeEventListener('storage', this.storageHandler)
    this.storageHandler = null
    this.subscribers.clear()
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private broadcast(msg: StateChangeMessage): void {
    for (const fn of this.subscribers) fn(msg)
  }

  // Compute the current snapshot for each (slide, dragId) touched by `event`. Used by
  // undo/redo to tell the caller exactly which elements need their visual position
  // re-applied via the registry.
  private affectedSubsetForEvent(event: EditEvent): AffectedItem[] {
    const all = this.computeAllState()
    const slideKey = String(event.slideNo)
    const byId = all[slideKey] ?? {}
    return event.items.map(it => ({
      slideNo: event.slideNo,
      dragId: it.dragId,
      state: byId[it.dragId] ?? null,
    }))
  }
}

function snapshotsEqual(a: ElementSnapshot | null, b: ElementSnapshot | null): boolean {
  if (a === null && b === null)
    return true
  if (a === null || b === null)
    return false
  return a.x0 === b.x0 && a.y0 === b.y0 && a.width === b.width && a.height === b.height
    && a.rotate === b.rotate && a.zIndex === b.zIndex
    && a.cropTop === b.cropTop && a.cropRight === b.cropRight
    && a.cropBottom === b.cropBottom && a.cropLeft === b.cropLeft
}
