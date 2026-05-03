import type { ResolvedSlidevOptions } from '@slidev/types'
import type Database from 'better-sqlite3'
import type { Connect, Plugin } from 'vite'
import type { EditEvent } from '../state/types'
import { Buffer } from 'node:buffer'
import {
  commitYaml,
  getSnapshot,
  hydrateIfEmpty,
  insertEdit,
  listEvents,
  redo,
  restoreToEvent,
  undo,
} from '../state/core'
import { openStateDb } from '../state/db'

const MAX_BODY_BYTES = 10_000_000

// Heartbeat keeps long-lived SSE connections from being killed by intermediate proxies
// or browser timeouts. 25 s sits comfortably under the typical 30–60 s idle limit.
const SSE_HEARTBEAT_MS = 25_000

// All messages share this envelope. The source field lets clients optimize (e.g. yaml-commit
// only refreshes the bookmark id, not the full event list) but for v1 every client just
// re-fetches state + events — the source is informational.
interface StateChangeMessage {
  type: 'state-change'
  source: 'edit' | 'undo' | 'redo' | 'restore' | 'yaml-commit'
  topActiveEventId: number | null
  triggeringEventId?: number | null
}

function readJsonBody<T = unknown>(req: Connect.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`Body exceeds ${MAX_BODY_BYTES} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) {
        resolve({} as T)
        return
      }
      try {
        resolve(JSON.parse(raw) as T)
      }
      catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}

function sendJson(res: Connect.ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function createStatePlugin(options: ResolvedSlidevOptions): Plugin {
  let db: Database.Database | null = null
  let initialized = false
  async function ensureDb(): Promise<Database.Database> {
    if (!db) {
      db = openStateDb(options.userRoot)
    }
    if (!initialized) {
      await hydrateIfEmpty(db, options.userRoot)
      initialized = true
    }
    return db
  }

  // Live SSE subscribers. Each entry is a still-open response we write into. The set is
  // pruned on connection-close (req 'close' handler below).
  const subscribers = new Set<Connect.ServerResponse>()

  function broadcast(msg: StateChangeMessage): void {
    if (subscribers.size === 0)
      return
    const data = `data: ${JSON.stringify(msg)}\n\n`
    for (const res of subscribers) {
      try {
        res.write(data)
      }
      catch {
        // Write errors leave the response in a bad state; the 'close' handler will drop it.
      }
    }
  }

  // Look up the current top active event id without allocating a snapshot. Cheap query.
  function topActiveId(handle: Database.Database): number | null {
    const row = handle.prepare(
      'SELECT MAX(id) AS id FROM events WHERE undone_at IS NULL AND abandoned_at IS NULL',
    ).get() as { id: number | null } | undefined
    return row?.id ?? null
  }

  return {
    name: 'slidev:state',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/__slidev/state'))
          return next()

        try {
          const path = url.split('?')[0]
          const handle = await ensureDb()

          // GET /__slidev/state — full snapshot for cold-start hydration
          if (req.method === 'GET' && path === '/__slidev/state') {
            return sendJson(res, 200, getSnapshot(handle))
          }

          // GET /__slidev/state/stream — SSE feed of state-change notifications. The client
          // reacts by re-fetching state + events; we intentionally don't push event payloads
          // through the channel to keep the server-side serialization simple and avoid
          // diverging from the canonical /state and /events endpoints.
          if (req.method === 'GET' && path === '/__slidev/state/stream') {
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/event-stream')
            res.setHeader('Cache-Control', 'no-cache, no-transform')
            res.setHeader('Connection', 'keep-alive')
            // Disable proxy buffering (Nginx etc.) — without this, EventSource clients can
            // sit waiting for the response body to be flushed.
            res.setHeader('X-Accel-Buffering', 'no')
            // Tell EventSource to reconnect after 5 s on disconnect (default is 3 s).
            res.write('retry: 5000\n\n')
            // Initial hello so the client knows the server's current top id and can decide
            // whether it needs a full re-fetch (it has likely just fetched, but a reconnect
            // after a missed broadcast would otherwise leave it stale).
            const hello: StateChangeMessage = {
              type: 'state-change',
              source: 'edit',
              topActiveEventId: topActiveId(handle),
            }
            res.write(`data: ${JSON.stringify(hello)}\n\n`)
            subscribers.add(res)
            const heartbeat = setInterval(() => {
              try {
                res.write(`: hb\n\n`)
              }
              catch {
                // Connection broken; cleanup will fire from req 'close'.
              }
            }, SSE_HEARTBEAT_MS)
            req.on('close', () => {
              clearInterval(heartbeat)
              subscribers.delete(res)
            })
            return // keep connection open
          }

          // GET /__slidev/state/events?slide=<n>&since=<id>&limit=<n> — paged event feed
          if (req.method === 'GET' && path === '/__slidev/state/events') {
            const u = new URL(url, 'http://localhost')
            const slideParam = u.searchParams.get('slide')
            const sinceParam = u.searchParams.get('since')
            const limitParam = u.searchParams.get('limit')
            const events = listEvents(handle, {
              slideNo: slideParam ? Number(slideParam) : undefined,
              sinceId: sinceParam ? Number(sinceParam) : undefined,
              limit: limitParam ? Number(limitParam) : undefined,
            })
            return sendJson(res, 200, { events })
          }

          if (req.method === 'POST' && path === '/__slidev/state/edit') {
            const body = await readJsonBody<{
              slideNo: number
              kind: string
              items: Array<{ dragId: string, before: unknown, after: unknown }>
              label?: string | null
            }>(req)
            if (typeof body.slideNo !== 'number' || !body.kind || !Array.isArray(body.items))
              return sendJson(res, 400, { error: 'edit requires {slideNo, kind, items[]}' })
            const event = insertEdit(handle, {
              slideNo: body.slideNo,
              kind: body.kind as never,
              items: body.items as never,
              label: body.label ?? null,
            })
            broadcast({ type: 'state-change', source: 'edit', topActiveEventId: event.id, triggeringEventId: event.id })
            return sendJson(res, 200, { event })
          }

          if (req.method === 'POST' && path === '/__slidev/state/undo') {
            const body = await readJsonBody<{ eventId?: number }>(req).catch(() => ({} as { eventId?: number }))
            const result = undo(handle, body.eventId)
            if (result)
              broadcast({ type: 'state-change', source: 'undo', topActiveEventId: result.topActiveEventId, triggeringEventId: result.event.id })
            return sendJson(res, 200, result ?? { event: null, affected: [], topActiveEventId: null })
          }

          if (req.method === 'POST' && path === '/__slidev/state/redo') {
            const body = await readJsonBody<{ eventId?: number }>(req).catch(() => ({} as { eventId?: number }))
            const result = redo(handle, body.eventId)
            if (result)
              broadcast({ type: 'state-change', source: 'redo', topActiveEventId: result.topActiveEventId, triggeringEventId: result.event.id })
            return sendJson(res, 200, result ?? { event: null, affected: [], topActiveEventId: null })
          }

          if (req.method === 'POST' && path === '/__slidev/state/commit-yaml') {
            const result = await commitYaml(handle, options.userRoot)
            broadcast({ type: 'state-change', source: 'yaml-commit', topActiveEventId: result.committedEventId })
            return sendJson(res, 200, result)
          }

          if (req.method === 'POST' && path === '/__slidev/state/restore') {
            const body = await readJsonBody<{ eventId?: number }>(req).catch(() => ({} as { eventId?: number }))
            if (typeof body.eventId !== 'number')
              return sendJson(res, 400, { error: 'restore requires {eventId}' })
            const event: EditEvent | null = restoreToEvent(handle, body.eventId)
            if (event)
              broadcast({ type: 'state-change', source: 'restore', topActiveEventId: event.id, triggeringEventId: event.id })
            return sendJson(res, 200, { event })
          }

          return next()
        }
        catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return sendJson(res, 500, { error: message })
        }
      })

      server.httpServer?.once('close', () => {
        // Tear down any open SSE connections so they don't keep the process alive.
        for (const res of subscribers) {
          try {
            res.end()
          }
          catch {
            // ignore
          }
        }
        subscribers.clear()
        db?.close()
        db = null
        initialized = false
      })
    },
  }
}
