import type { ResolvedSlidevOptions } from '@slidev/types'
import type Database from 'better-sqlite3'
import type { Connect, Plugin } from 'vite'
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
            return sendJson(res, 200, { event })
          }

          if (req.method === 'POST' && path === '/__slidev/state/undo') {
            const body = await readJsonBody<{ eventId?: number }>(req).catch(() => ({} as { eventId?: number }))
            const result = undo(handle, body.eventId)
            return sendJson(res, 200, result ?? { event: null, affected: [], topActiveEventId: null })
          }

          if (req.method === 'POST' && path === '/__slidev/state/redo') {
            const body = await readJsonBody<{ eventId?: number }>(req).catch(() => ({} as { eventId?: number }))
            const result = redo(handle, body.eventId)
            return sendJson(res, 200, result ?? { event: null, affected: [], topActiveEventId: null })
          }

          if (req.method === 'POST' && path === '/__slidev/state/commit-yaml') {
            const result = await commitYaml(handle, options.userRoot)
            return sendJson(res, 200, result)
          }

          if (req.method === 'POST' && path === '/__slidev/state/restore') {
            const body = await readJsonBody<{ eventId?: number }>(req).catch(() => ({} as { eventId?: number }))
            if (typeof body.eventId !== 'number')
              return sendJson(res, 400, { error: 'restore requires {eventId}' })
            const event = restoreToEvent(handle, body.eventId)
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
        db?.close()
        db = null
        initialized = false
      })
    },
  }
}
