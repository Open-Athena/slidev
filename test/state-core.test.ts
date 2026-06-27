import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getSnapshot,
  hydrateIfEmpty,
  insertEdit,
  listEvents,
  redo,
  restoreToEvent,
  revertToYaml,
  undo,
} from '../packages/slidev/node/state/core'
import { openStateDb } from '../packages/slidev/node/state/db'

const SNAP_A = { x0: 100, y0: 100, width: 50, height: 50, rotate: 0, zIndex: 100, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 }
const SNAP_B = { x0: 200, y0: 200, width: 50, height: 50, rotate: 0, zIndex: 100, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 }
const SNAP_C = { x0: 300, y0: 300, width: 50, height: 50, rotate: 0, zIndex: 100, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 }

describe('state/core', () => {
  let dir: string
  let db: Database.Database

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'slidev-state-'))
    // `openStateDb` is async (lazy better-sqlite3 import) and may return null if the
    // optionalDependency isn't installed; in this repo it always is, so assert non-null.
    const handle = await openStateDb(dir)
    if (!handle)
      throw new Error('better-sqlite3 unavailable in test environment')
    db = handle
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('insertEdit', () => {
    it('returns the persisted event with an assigned id', () => {
      const e = insertEdit(db, {
        slideNo: 1,
        kind: 'move',
        items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }],
      })
      expect(e.id).toBeGreaterThan(0)
      expect(e.kind).toBe('move')
      expect(e.items).toEqual([{ dragId: 'foo', before: SNAP_A, after: SNAP_B }])
      expect(e.undoneAt).toBeNull()
      expect(e.abandonedAt).toBeNull()
    })

    it('upserts element_state with the after snapshot', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      const snap = getSnapshot(db)
      expect(snap.state['1'].foo).toEqual(SNAP_A)
    })

    it('removes element_state when after is null (delete semantics)', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 1, kind: 'delete', items: [{ dragId: 'foo', before: SNAP_A, after: null }] })
      const snap = getSnapshot(db)
      expect(snap.state['1']?.foo).toBeUndefined()
    })

    it('round-trips DeleteSourceContext through the payload', () => {
      const e = insertEdit(db, {
        slideNo: 1,
        kind: 'delete',
        items: [{ dragId: 'foo', before: SNAP_A, after: null }],
        source: { lineRange: [3, 5], lines: ['![](a.png)', ''] },
      })
      expect(e.source).toEqual({ lineRange: [3, 5], lines: ['![](a.png)', ''] })
      // And it survives a fresh fetch via listEvents
      const fetched = listEvents(db)[0]
      expect(fetched.source).toEqual({ lineRange: [3, 5], lines: ['![](a.png)', ''] })
    })

    it('omits source from the payload when not provided', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }] })
      const fetched = listEvents(db)[0]
      expect(fetched.source).toBeUndefined()
    })

    it('abandons any currently-undone events on new edit (redo cliff)', () => {
      const e1 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      const e2 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }] })
      undo(db) // undoes e2
      const e3 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_C }] })

      const events = listEvents(db)
      const byId = Object.fromEntries(events.map(e => [e.id, e]))
      expect(byId[e1.id].abandonedAt).toBeNull()
      expect(byId[e2.id].abandonedAt).not.toBeNull() // got abandoned by e3
      expect(byId[e3.id].abandonedAt).toBeNull()
    })
  })

  describe('undo / redo', () => {
    it('undo flips undoneAt and recomputes state to previous active', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }] })
      const r = undo(db)
      expect(r?.event.undoneAt).not.toBeNull()
      const snap = getSnapshot(db)
      expect(snap.state['1'].foo).toEqual(SNAP_A) // reverted to previous edit
    })

    it('redo flips undoneAt back and recomputes state', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }] })
      undo(db)
      const r = redo(db)
      expect(r?.event.undoneAt).toBeNull()
      expect(getSnapshot(db).state['1'].foo).toEqual(SNAP_B)
    })

    it('returns null when nothing to undo', () => {
      expect(undo(db)).toBeNull()
    })

    it('returns null when nothing to redo', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      expect(redo(db)).toBeNull()
    })

    it('redo pops in LIFO order (reverse-undo)', () => {
      const e1 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'a', before: null, after: SNAP_A }] })
      const e2 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'b', before: null, after: SNAP_B }] })
      const e3 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'c', before: null, after: SNAP_C }] })
      // Undo all three: 3 first, then 2, then 1. Stack of undone is [3, 2, 1] (top=1).
      undo(db) // undo e3
      undo(db) // undo e2
      undo(db) // undo e1
      // Redo should bring back e1 first (most-recently-undone)
      const r1 = redo(db)
      expect(r1?.event.id).toBe(e1.id)
      const r2 = redo(db)
      expect(r2?.event.id).toBe(e2.id)
      const r3 = redo(db)
      expect(r3?.event.id).toBe(e3.id)
    })

    it('delete event undo restores state derived from earlier active event', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 1, kind: 'delete', items: [{ dragId: 'foo', before: SNAP_A, after: null }], source: { lineRange: [0, 1], lines: ['![](a)'] } })
      expect(getSnapshot(db).state['1']?.foo).toBeUndefined()
      undo(db)
      // recomputeElements should re-derive state from the prior move event
      expect(getSnapshot(db).state['1'].foo).toEqual(SNAP_A)
    })

    it('delete event redo re-drops the element_state row', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 1, kind: 'delete', items: [{ dragId: 'foo', before: SNAP_A, after: null }], source: { lineRange: [0, 1], lines: ['![](a)'] } })
      undo(db)
      redo(db)
      expect(getSnapshot(db).state['1']?.foo).toBeUndefined()
    })
  })

  describe('restoreToEvent', () => {
    it('inserts a kind=restore event with paired before/after items', () => {
      const e1 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }] })
      const restored = restoreToEvent(db, e1.id)
      expect(restored?.kind).toBe('restore')
      expect(restored?.items).toHaveLength(1)
      expect(restored?.items[0]).toEqual({ dragId: 'foo', before: SNAP_B, after: SNAP_A })
      // element_state should now match e1's after
      expect(getSnapshot(db).state['1'].foo).toEqual(SNAP_A)
    })

    it('returns null when there is no actual change to apply', () => {
      const e1 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      // Restoring to e1 when state is already e1's after — should be a no-op.
      const result = restoreToEvent(db, e1.id)
      expect(result).toBeNull()
    })
  })

  describe('hydrateIfEmpty', () => {
    it('returns false when events table is non-empty', async () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      const hydrated = await hydrateIfEmpty(db, dir)
      expect(hydrated).toBe(false)
    })

    it('inserts hydrate events from slides.coords.yaml on cold start', async () => {
      writeFileSync(
        join(dir, 'slides.coords.yaml'),
        '"1":\n  foo: 75,75,50,50\n',
      )
      const hydrated = await hydrateIfEmpty(db, dir)
      expect(hydrated).toBe(true)
      const events = listEvents(db)
      expect(events).toHaveLength(1)
      expect(events[0].kind).toBe('hydrate')
      expect(getSnapshot(db).state['1'].foo).toEqual(SNAP_A)
    })

    it('does nothing when no yaml is present', async () => {
      const hydrated = await hydrateIfEmpty(db, dir)
      expect(hydrated).toBe(true) // returns true (no events) — but doesn't insert events
      expect(listEvents(db)).toHaveLength(0)
    })
  })

  describe('revertToYaml', () => {
    it('drops all events and re-hydrates from yaml', async () => {
      writeFileSync(
        join(dir, 'slides.coords.yaml'),
        '"1":\n  foo: 75,75,50,50\n',
      )
      // Hydrate so there's an event
      await hydrateIfEmpty(db, dir)
      // Add another edit
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }] })
      expect(listEvents(db).length).toBeGreaterThanOrEqual(2)

      const reverted = await revertToYaml(db, dir)
      expect(reverted?.kind).toBe('hydrate')
      // Only the new hydrate event should remain
      const events = listEvents(db)
      expect(events).toHaveLength(1)
      expect(events[0].kind).toBe('hydrate')
      expect(getSnapshot(db).state['1'].foo).toEqual(SNAP_A)
    })
  })

  describe('listEvents', () => {
    it('orders events DESC by id', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'a', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'b', before: null, after: SNAP_B }] })
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'c', before: null, after: SNAP_C }] })
      const events = listEvents(db)
      expect(events.map(e => e.items[0].dragId)).toEqual(['c', 'b', 'a'])
    })

    it('filters by slideNo', () => {
      insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'a', before: null, after: SNAP_A }] })
      insertEdit(db, { slideNo: 2, kind: 'move', items: [{ dragId: 'b', before: null, after: SNAP_B }] })
      const slide1 = listEvents(db, { slideNo: 1 })
      expect(slide1).toHaveLength(1)
      expect(slide1[0].slideNo).toBe(1)
    })

    it('limit caps the number returned', () => {
      for (let i = 0; i < 5; i++)
        insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: `d${i}`, before: null, after: SNAP_A }] })
      expect(listEvents(db, { limit: 2 })).toHaveLength(2)
    })

    it('sinceId filters to events with id > sinceId', () => {
      const events = [0, 1, 2, 3].map(i =>
        insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: `d${i}`, before: null, after: SNAP_A }] }),
      )
      const since = events[1].id
      const filtered = listEvents(db, { sinceId: since })
      expect(filtered.every(e => e.id > since)).toBe(true)
    })
  })

  describe('topActiveEventId tracking via getSnapshot', () => {
    it('reports the highest non-undone, non-abandoned event id', () => {
      const e1 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: null, after: SNAP_A }] })
      expect(getSnapshot(db).topActiveEventId).toBe(e1.id)
      const e2 = insertEdit(db, { slideNo: 1, kind: 'move', items: [{ dragId: 'foo', before: SNAP_A, after: SNAP_B }] })
      expect(getSnapshot(db).topActiveEventId).toBe(e2.id)
      undo(db)
      expect(getSnapshot(db).topActiveEventId).toBe(e1.id)
      undo(db)
      expect(getSnapshot(db).topActiveEventId).toBeNull()
    })
  })
})
