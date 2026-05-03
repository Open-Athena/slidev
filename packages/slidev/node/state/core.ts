import type Database from 'better-sqlite3'
import type { CoordsMap } from '../coords'
import type {
  AllElementState,
  CommitResult,
  EditEvent,
  EditItem,
  EditKind,
  ElementSnapshot,
  StateSnapshot,
} from './types'
import { loadCoords, saveCoordsForSlide } from '../coords'

interface EventRow {
  id: number
  ts: number
  slide_no: number
  kind: string
  payload: string
  undone_at: number | null
  abandoned_at: number | null
  label: string | null
}

function rowToEvent(row: EventRow): EditEvent {
  return {
    id: row.id,
    ts: row.ts,
    slideNo: row.slide_no,
    kind: row.kind as EditKind,
    items: JSON.parse(row.payload).items as EditItem[],
    undoneAt: row.undone_at,
    abandonedAt: row.abandoned_at,
    label: row.label,
  }
}

function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

function topActiveEventId(db: Database.Database): number | null {
  const row = db.prepare(
    'SELECT MAX(id) AS id FROM events WHERE undone_at IS NULL AND abandoned_at IS NULL',
  ).get() as { id: number | null } | undefined
  return row?.id ?? null
}

// The "next event to redo" is the one most recently marked undone — *not* the highest id
// among undone events. After `undo(5), undo(4), undo(3)`, the user expects redo to bring
// back #3 first (LIFO of the undo stack), so we order by `undone_at DESC`. Ties (same-ms
// undones, very rare) tie-break by id ASC, since a top-undo sequence undoes events in DESC
// id order, so the lower id within a tied batch corresponds to the later undo.
function topRedoableEventId(db: Database.Database): number | null {
  const row = db.prepare(
    'SELECT id FROM events WHERE undone_at IS NOT NULL AND abandoned_at IS NULL ORDER BY undone_at DESC, id ASC LIMIT 1',
  ).get() as { id: number } | undefined
  return row?.id ?? null
}

export function getEvent(db: Database.Database, id: number): EditEvent | null {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined
  return row ? rowToEvent(row) : null
}

export function getAllState(db: Database.Database): AllElementState {
  const rows = db.prepare('SELECT slide_no, drag_id, state FROM element_state').all() as Array<{
    slide_no: number
    drag_id: string
    state: string
  }>
  const out: AllElementState = {}
  for (const row of rows) {
    const slideKey = String(row.slide_no);
    (out[slideKey] ??= {})[row.drag_id] = JSON.parse(row.state) as ElementSnapshot
  }
  return out
}

export function getSnapshot(db: Database.Database): StateSnapshot {
  return {
    state: getAllState(db),
    topActiveEventId: topActiveEventId(db),
    lastYamlCommitEventId: Number(getMeta(db, 'last_yaml_commit_event_id')) || null,
  }
}

// Find the most recent active event that touches `(slideNo, dragId)` and return its `after`
// payload for that key. Returns null if no such event exists (the element should be removed
// from element_state).
function deriveStateFor(db: Database.Database, slideNo: number, dragId: string): ElementSnapshot | null {
  // Scan active events for this slide in DESC order. JSON-parse payload, look for the dragId
  // in items. Stop on first match. For typical decks (hundreds of events) this is plenty fast.
  const rows = db.prepare(
    'SELECT id, payload FROM events WHERE slide_no = ? AND undone_at IS NULL AND abandoned_at IS NULL ORDER BY id DESC',
  ).all(slideNo) as Array<{ id: number, payload: string }>
  for (const row of rows) {
    const items = (JSON.parse(row.payload).items ?? []) as EditItem[]
    const hit = items.find(it => it.dragId === dragId)
    if (hit)
      return hit.after
  }
  return null
}

function recomputeElements(
  db: Database.Database,
  keys: Array<{ slideNo: number, dragId: string }>,
  ts: number,
): void {
  const upsert = db.prepare(`
    INSERT INTO element_state(slide_no, drag_id, state, updated_at, source_event_id)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(slide_no, drag_id) DO UPDATE SET
      state = excluded.state,
      updated_at = excluded.updated_at,
      source_event_id = NULL
  `)
  const del = db.prepare('DELETE FROM element_state WHERE slide_no = ? AND drag_id = ?')
  for (const { slideNo, dragId } of keys) {
    const newState = deriveStateFor(db, slideNo, dragId)
    if (newState)
      upsert.run(slideNo, dragId, JSON.stringify(newState), ts)
    else
      del.run(slideNo, dragId)
  }
}

export interface InsertEditOptions {
  slideNo: number
  kind: EditKind
  items: EditItem[]
  label?: string | null
}

// Insert a new event. Atomically: bump abandoned_at on any currently-undone events (the
// redo cliff), insert the event row, and upsert element_state for each item with a non-null
// `after`. Returns the full event with its assigned id.
export function insertEdit(db: Database.Database, opts: InsertEditOptions): EditEvent {
  const ts = Date.now()
  const payload = JSON.stringify({ items: opts.items })
  const tx = db.transaction(() => {
    db.prepare('UPDATE events SET abandoned_at = ? WHERE undone_at IS NOT NULL AND abandoned_at IS NULL').run(ts)
    const info = db.prepare(
      'INSERT INTO events(ts, slide_no, kind, payload, label) VALUES (?, ?, ?, ?, ?)',
    ).run(ts, opts.slideNo, opts.kind, payload, opts.label ?? null)
    const eventId = Number(info.lastInsertRowid)
    const upsert = db.prepare(`
      INSERT INTO element_state(slide_no, drag_id, state, updated_at, source_event_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slide_no, drag_id) DO UPDATE SET
        state = excluded.state,
        updated_at = excluded.updated_at,
        source_event_id = excluded.source_event_id
    `)
    const del = db.prepare('DELETE FROM element_state WHERE slide_no = ? AND drag_id = ?')
    for (const item of opts.items) {
      if (item.after === null)
        del.run(opts.slideNo, item.dragId)
      else
        upsert.run(opts.slideNo, item.dragId, JSON.stringify(item.after), ts, eventId)
    }
    return eventId
  })
  const eventId = tx()
  return getEvent(db, eventId)!
}

export type AffectedItems = Array<{ slideNo: number, dragId: string, state: ElementSnapshot | null }>

export interface UndoRedoResult {
  event: EditEvent
  affected: AffectedItems
  topActiveEventId: number | null
}

function affectedKeys(event: EditEvent): Array<{ slideNo: number, dragId: string }> {
  return event.items.map(it => ({ slideNo: event.slideNo, dragId: it.dragId }))
}

function affectedSubset(db: Database.Database, keys: Array<{ slideNo: number, dragId: string }>): AffectedItems {
  const stmt = db.prepare('SELECT state FROM element_state WHERE slide_no = ? AND drag_id = ?')
  const out: AffectedItems = []
  for (const { slideNo, dragId } of keys) {
    const row = stmt.get(slideNo, dragId) as { state: string } | undefined
    out.push({
      slideNo,
      dragId,
      state: row ? (JSON.parse(row.state) as ElementSnapshot) : null,
    })
  }
  return out
}

export function undo(db: Database.Database, eventId?: number): UndoRedoResult | null {
  const id = eventId ?? topActiveEventId(db)
  if (id === null)
    return null
  const event = getEvent(db, id)
  if (!event || event.undoneAt !== null || event.abandonedAt !== null)
    return null
  const ts = Date.now()
  const tx = db.transaction(() => {
    db.prepare('UPDATE events SET undone_at = ? WHERE id = ?').run(ts, id)
    recomputeElements(db, affectedKeys(event), ts)
  })
  tx()
  return {
    event: getEvent(db, id)!,
    affected: affectedSubset(db, affectedKeys(event)),
    topActiveEventId: topActiveEventId(db),
  }
}

export function redo(db: Database.Database, eventId?: number): UndoRedoResult | null {
  const id = eventId ?? topRedoableEventId(db)
  if (id === null)
    return null
  const event = getEvent(db, id)
  if (!event || event.undoneAt === null || event.abandonedAt !== null)
    return null
  const ts = Date.now()
  const tx = db.transaction(() => {
    db.prepare('UPDATE events SET undone_at = NULL WHERE id = ?').run(id)
    recomputeElements(db, affectedKeys(event), ts)
  })
  tx()
  return {
    event: getEvent(db, id)!,
    affected: affectedSubset(db, affectedKeys(event)),
    topActiveEventId: topActiveEventId(db),
  }
}

// Convert ElementSnapshot → posStr (mirror of client serialization in useDragElements.ts).
// Output format matches what slides.coords.yaml stores today, so the client-side parser
// (no changes) keeps working when the YAML is the source of truth.
export function snapshotToPosStr(s: ElementSnapshot): string {
  // Coords used in slides.coords.yaml are top-left + size, not center-based.
  const x = Math.round(s.x0 - s.width / 2)
  const y = Math.round(s.y0 - s.height / 2)
  const w = Math.round(s.width)
  const h = Math.round(s.height)
  const r = Math.round(s.rotate)
  const z = Math.round(s.zIndex)
  const ct = Math.round(s.cropTop)
  const cr = Math.round(s.cropRight)
  const cb = Math.round(s.cropBottom)
  const cl = Math.round(s.cropLeft)
  const hasCrop = ct !== 0 || cr !== 0 || cb !== 0 || cl !== 0
  const hasZ = z !== 100
  let out = `${x},${y},${w},${h}`
  if (r !== 0 || hasZ || hasCrop)
    out += `,${r}`
  if (hasZ || hasCrop)
    out += `,${z}`
  if (hasCrop)
    out += `,${ct},${cr},${cb},${cl}`
  return out
}

function elementStateToCoords(state: AllElementState): CoordsMap {
  const out: CoordsMap = {}
  for (const [slideKey, byId] of Object.entries(state)) {
    const inner: Record<string, string> = {}
    for (const [dragId, snap] of Object.entries(byId))
      inner[dragId] = snapshotToPosStr(snap)
    out[slideKey] = inner
  }
  return out
}

// Flush element_state → slides.coords.yaml. Records the current top-active event id as the
// commit watermark so the client's "dirty" indicator can compute correctly.
export async function commitYaml(db: Database.Database, userRoot: string): Promise<CommitResult> {
  const state = getAllState(db)
  const coords = elementStateToCoords(state)
  const allSlideNos = new Set<string>()
  for (const k of Object.keys(coords)) allSlideNos.add(k)
  // We also need to drop slides that have no entries anymore. Easiest: read existing yaml
  // to find slide keys that are no longer in coords, then call saveCoordsForSlide(_, slide, {}).
  const existing = await loadCoords(userRoot)
  for (const k of Object.keys(existing)) allSlideNos.add(k)
  for (const slideKey of allSlideNos)
    await saveCoordsForSlide(userRoot, Number(slideKey), coords[slideKey] ?? {})
  const top = topActiveEventId(db)
  setMeta(db, 'last_yaml_commit_event_id', top !== null ? String(top) : '')
  return { committedEventId: top, dirty: false }
}

// Cold-start: if events table is empty, hydrate element_state from slides.coords.yaml and
// insert one synthetic kind='hydrate' event so the timeline has a clear origin.
export async function hydrateIfEmpty(db: Database.Database, userRoot: string): Promise<boolean> {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n
  if (count > 0)
    return false
  const coords = await loadCoords(userRoot)
  // posStr → ElementSnapshot (inverse of snapshotToPosStr). For hydration we only need the
  // values that round-trip cleanly; no crop/rotate defaults are baked in.
  const ts = Date.now()
  const tx = db.transaction(() => {
    for (const [slideKey, byId] of Object.entries(coords)) {
      const slideNo = Number(slideKey)
      const items: EditItem[] = []
      for (const [dragId, posStr] of Object.entries(byId)) {
        const snap = posStrToSnapshot(posStr)
        if (!snap)
          continue
        items.push({ dragId, before: null, after: snap })
      }
      if (items.length === 0)
        continue
      const payload = JSON.stringify({ items })
      const info = db.prepare(
        'INSERT INTO events(ts, slide_no, kind, payload, label) VALUES (?, ?, ?, ?, ?)',
      ).run(ts, slideNo, 'hydrate', payload, 'hydrate-from-yaml')
      const eventId = Number(info.lastInsertRowid)
      const upsert = db.prepare(`
        INSERT INTO element_state(slide_no, drag_id, state, updated_at, source_event_id)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const item of items)
        upsert.run(slideNo, item.dragId, JSON.stringify(item.after!), ts, eventId)
    }
    const top = topActiveEventId(db)
    setMeta(db, 'last_yaml_commit_event_id', top !== null ? String(top) : '')
  })
  tx()
  return true
}

// Inverse of snapshotToPosStr — parses "x,y,w,h[,r[,z[,ct,cr,cb,cl]]]". The bracket/`[…]`
// directive form is normalized away by the client before posting; YAML stores the bare form.
export function posStrToSnapshot(posStr: string): ElementSnapshot | null {
  const trimmed = posStr.trim().replace(/^\[/, '').replace(/\]$/, '')
  const parts = trimmed.split(',').map(p => p.trim())
  if (parts.length < 3)
    return null
  const num = (s: string, fallback: number) => {
    if (s === '_' || s === 'NaN' || s === '')
      return fallback
    const n = Number(s)
    return Number.isFinite(n) ? n : fallback
  }
  const x = num(parts[0], 0)
  const y = num(parts[1], 0)
  const w = num(parts[2], 0)
  const h = num(parts[3] ?? '_', w) // autoHeight encoded as `_` or `NaN`; fall back to w
  const r = num(parts[4] ?? '0', 0)
  const z = num(parts[5] ?? '100', 100)
  const ct = num(parts[6] ?? '0', 0)
  const cr = num(parts[7] ?? '0', 0)
  const cb = num(parts[8] ?? '0', 0)
  const cl = num(parts[9] ?? '0', 0)
  return {
    x0: x + w / 2,
    y0: y + h / 2,
    width: w,
    height: h,
    rotate: r,
    zIndex: z,
    cropTop: ct,
    cropRight: cr,
    cropBottom: cb,
    cropLeft: cl,
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

// Restore the slide that `targetEventId` lives on to the state it had right after that
// event was applied. Walks all non-abandoned events on that slide up to and including the
// target in id order, replaying their `after` snapshots; diffs against current state and
// inserts a single `kind='restore'` event whose payload contains the per-element
// `(before=current, after=historical)` pairs. Returns the new restore event, or null if
// nothing differs (no-op).
export function restoreToEvent(db: Database.Database, targetEventId: number): EditEvent | null {
  const target = getEvent(db, targetEventId)
  if (!target)
    return null
  const slideNo = target.slideNo
  const replayRows = db.prepare(
    'SELECT id, payload FROM events WHERE id <= ? AND slide_no = ? AND abandoned_at IS NULL ORDER BY id ASC',
  ).all(targetEventId, slideNo) as Array<{ id: number, payload: string }>

  // Build the historical snapshot map by replaying every non-abandoned event in id order
  // (regardless of current undone status — undone is a *now* marker, not a *was* marker).
  const historical = new Map<string, ElementSnapshot | null>()
  for (const row of replayRows) {
    const items = (JSON.parse(row.payload).items ?? []) as EditItem[]
    for (const item of items)
      historical.set(item.dragId, item.after)
  }

  const currentRows = db.prepare(
    'SELECT drag_id, state FROM element_state WHERE slide_no = ?',
  ).all(slideNo) as Array<{ drag_id: string, state: string }>
  const current = new Map<string, ElementSnapshot>()
  for (const row of currentRows)
    current.set(row.drag_id, JSON.parse(row.state) as ElementSnapshot)

  const allKeys = new Set<string>([...historical.keys(), ...current.keys()])
  const items: EditItem[] = []
  for (const dragId of allKeys) {
    const before = current.get(dragId) ?? null
    const after = historical.get(dragId) ?? null
    if (snapshotsEqual(before, after))
      continue
    items.push({ dragId, before, after })
  }
  if (items.length === 0)
    return null

  return insertEdit(db, {
    slideNo,
    kind: 'restore',
    items,
    label: `restore-to-${targetEventId}`,
  })
}

export function listEvents(
  db: Database.Database,
  opts: { slideNo?: number, sinceId?: number, limit?: number } = {},
): EditEvent[] {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.slideNo !== undefined) {
    where.push('slide_no = ?')
    params.push(opts.slideNo)
  }
  if (opts.sinceId !== undefined) {
    where.push('id > ?')
    params.push(opts.sinceId)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000)
  const rows = db.prepare(`SELECT * FROM events ${whereSql} ORDER BY id DESC LIMIT ?`).all(...params, limit) as EventRow[]
  return rows.map(rowToEvent)
}
