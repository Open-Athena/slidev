import type { ResolvedSlidevOptions } from '@slidev/types'
import type { Connect, Plugin } from 'vite'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join, posix, resolve } from 'node:path'

export interface InsertConfig {
  dir: string
  acceptedTypes: string[]
  maxBytes: number
}

const DEFAULT_INSERT_CONFIG: InsertConfig = {
  dir: 'images',
  acceptedTypes: ['image/*', 'video/*'],
  maxBytes: 50_000_000,
}

function resolveInsertConfig(options: ResolvedSlidevOptions): InsertConfig {
  const headmatter = options.data.headmatter as { insert?: Partial<InsertConfig> } | undefined
  const cfg = headmatter?.insert ?? {}
  return {
    dir: cfg.dir ?? DEFAULT_INSERT_CONFIG.dir,
    acceptedTypes: cfg.acceptedTypes ?? DEFAULT_INSERT_CONFIG.acceptedTypes,
    maxBytes: cfg.maxBytes ?? DEFAULT_INSERT_CONFIG.maxBytes,
  }
}

function readBody(req: Connect.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        rejectBody(new Error(`Upload exceeds maxBytes (${maxBytes})`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', rejectBody)
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
  })
}

function sanitizeFilename(raw: string): { stem: string, ext: string } {
  const ext = extname(raw).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8)
  const stemRaw = raw.slice(0, raw.length - extname(raw).length)
  const stem = stemRaw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64) || 'file'
  return { stem, ext }
}

function mimeMatchesAccepted(mime: string, accepted: string[]): boolean {
  if (!mime)
    return false
  return accepted.some((pattern) => {
    if (pattern === '*' || pattern === '*/*')
      return true
    if (pattern.endsWith('/*'))
      return mime.startsWith(`${pattern.slice(0, -1)}`)
    return mime === pattern
  })
}

function sendJson(res: Connect.ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function createUploadPlugin(options: ResolvedSlidevOptions): Plugin {
  return {
    name: 'slidev:upload',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__slidev/upload'))
          return next()
        if (req.method !== 'POST')
          return next()

        try {
          const cfg = resolveInsertConfig(options)
          const url = new URL(req.url, 'http://localhost')
          const rawName = url.searchParams.get('filename') || 'upload'
          const contentType = (req.headers['content-type'] as string | undefined) || url.searchParams.get('type') || ''

          if (!mimeMatchesAccepted(contentType, cfg.acceptedTypes)) {
            return sendJson(res, 415, { error: `Content-Type "${contentType}" not in acceptedTypes` })
          }

          const buf = await readBody(req, cfg.maxBytes)
          const { stem, ext } = sanitizeFilename(rawName)

          const destDir = resolve(options.userRoot, 'public', cfg.dir)
          await mkdir(destDir, { recursive: true })

          let safeName = `${stem}${ext}`
          if (existsSync(join(destDir, safeName))) {
            const hash = createHash('sha1').update(buf).digest('hex').slice(0, 6)
            safeName = `${stem}-${hash}${ext}`
          }
          const destPath = join(destDir, safeName)
          await writeFile(destPath, buf)

          const publicUrl = `/${posix.join(cfg.dir, safeName)}`
          return sendJson(res, 200, {
            url: publicUrl,
            path: destPath,
            bytes: buf.length,
          })
        }
        catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return sendJson(res, 400, { error: message })
        }
      })
    },
  }
}
