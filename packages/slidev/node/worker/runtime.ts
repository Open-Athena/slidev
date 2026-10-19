// The Cloudflare Worker that `slidev build --worker` deploys in front of `dist/` (Workers + static
// assets). It's built on its own into `dist/og-worker.mjs` (see `tsdown.worker.config.ts`), copied
// into the deck's build output as `_worker/runtime.mjs`, and must stay free of Node APIs and
// npm imports. `@cloudflare/puppeteer` is passed in by the generated entry, never imported here.
//
// What it does (see specs/done/dynamic-og.md):
// - slide URLs requested by an unfurler (or every request, with `publish.ogAlwaysStamp`) get the
//   per-slide share tags stamped into the static shell, computed for that URL's params;
// - `/_og/<n>-<slug>.<ext>` serves the pre-rendered card when the URL has no (non-default)
//   params, else a card rendered on demand and kept in the Cache API;
// - an optional `gate` hook blocks everything but `publicPaths` (any method, any path), and
//   unfurlers that it blocks on a slide URL get a meta-only page instead of the SPA (while
//   `publicCards`). `createAuthWorker` (`worker/auth.ts`) is a gate built on `@open-athena/auth`.

import type { ShareInfo, SlideParams } from './shared'
import { canonicalizeParams, htmlEscape, matchesPathPattern, shareTags } from './shared'

export { canonicalizeParams, normalizeSlideParams, shareTags } from './shared'

export interface WorkerSlide {
  no: number
  slug: string
  title: string
  description: string
  /** App path of the canonical slide URL, e.g. `/3-install`. */
  path: string
  /** App path of the pre-rendered default card, e.g. `/_og/3-install.jpg`. */
  image: string
  /** Content hash of the slide (the build's card cache key); stamped as the card's `v`. */
  hash: string
  /** Whether `/<slug>` resolves to this slide (unique, unreserved slugs only). */
  bareSlug: boolean
  /** Old slugs that still name the slide: `/<n>-<alias>` and `_og/<n>-<alias>.<ext>` resolve. */
  aliases?: string[]
  /** Aliases that resolve bare, `/<alias>` (unique among slugs and aliases, unreserved). */
  bareAliases?: string[]
  params?: SlideParams
}

export interface WorkerManifest {
  version: 1
  /** Absolute origin + path the deck is published at (`publish.baseUrl`). */
  baseUrl: string
  /** Vite `base`, e.g. `/` or `/deck/`. */
  base: string
  /** Stamp tags for every slide request, not only unfurlers (`publish.ogAlwaysStamp`). */
  alwaysStamp: boolean
  /** App paths reachable without passing the `gate` (includes `/_og/*` while `publicCards`). */
  publicPaths: string[]
  /**
   * Whether cards, and the share tags of the slides a gate blocks, are public. When `false`,
   * `/_og/*` goes through the gate like everything else, and blocked unfurlers get the gate's
   * response.
   */
  publicCards: boolean
  card: {
    size: [number, number]
    format: 'jpg' | 'png'
    quality: number
  }
  slides: WorkerSlide[]
}

/** The subset of the Workers runtime types this file uses. */
interface Fetcher { fetch: (input: Request | string, init?: RequestInit) => Promise<Response> }
interface ExecutionContext { waitUntil: (promise: Promise<unknown>) => void }
export interface WorkerEnv {
  ASSETS: Fetcher
  /** When set, the browser renderer sends it as `X-Slidev-Render-Token`, and the gate lets those requests through. */
  SLIDEV_RENDER_TOKEN?: string
  [binding: string]: unknown
}

interface HTMLElementLike {
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
  setInnerContent: (content: string) => void
  onEndTag: (handler: (tag: { before: (content: string, options?: { html: boolean }) => void }) => void) => void
}
interface HTMLRewriterLike {
  on: (selector: string, handlers: { element: (el: HTMLElementLike) => void }) => HTMLRewriterLike
  transform: (response: Response) => Response
}
declare const HTMLRewriter: { new (): HTMLRewriterLike }
declare const caches: { default: { match: (key: Request) => Promise<Response | undefined>, put: (key: Request, res: Response) => Promise<void> } }

export interface RenderRequest {
  env: WorkerEnv
  slide: WorkerSlide
  /** Canonical query (no `?`); never empty, since default cards aren't rendered. */
  query: string
  /** Absolute URL of the slide in print mode, with the params applied. */
  url: string
  card: WorkerManifest['card']
}

/** Renders a card, or returns `null` when it can't (e.g. its binding isn't configured). */
export type CardRenderer = (req: RenderRequest) => Promise<Uint8Array | ArrayBuffer | null>

/** What `createWorker` knows about a request when it asks the gate. */
export interface GateInfo {
  /** The slide a GET / HEAD of a slide URL names. */
  slide?: WorkerSlide
  /** That slide's share info for the URL's (canonical) params. */
  share?: ShareInfo
  /** Whether the user agent looks like a link unfurler. */
  unfurler: boolean
  /** Vite `base`, with a trailing slash. */
  base: string
}

/**
 * Return a `Response` to block the request (401, a login redirect, …), or nothing to let it
 * through. Responses to requests it lets through are marked `Cache-Control: private`.
 */
export type Gate = (request: Request, env: WorkerEnv, ctx: ExecutionContext, info: GateInfo) => Response | undefined | Promise<Response | undefined>

export interface WorkerOptions {
  renderer?: CardRenderer
  gate?: Gate
  /** Override which user agents count as link unfurlers. */
  unfurlers?: RegExp
}

// Link-preview fetchers: chat apps, social networks, search engines' preview bots. Erring towards
// matching is cheap, since a stamped shell still boots the SPA.
export const UNFURLER_RE = /bot\b|bot\/|crawler|spider|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|iframely|slack|discord|telegram|whatsapp|skypeuripreview|linkedin|mastodon|bluesky|cardyb|pinterest|vkshare|redditbot|tumblr|outbrain|quora link preview|google-inspectiontool|applebot/i

export const RENDER_TOKEN_HEADER = 'X-Slidev-Render-Token'

/** The slide a path (relative to `base`, no leading slash) names: `3`, `3-install` or `install`. */
export function matchSlide(slides: WorkerSlide[], rel: string): WorkerSlide | undefined {
  const r = rel.replace(/\/+$/, '')
  if (!r || r.includes('/'))
    return undefined
  if (/^\d+$/.test(r))
    return slides.find(s => s.no === Number(r))
  const m = r.match(/^(\d+)-(.+)$/)
  if (m) {
    const s = slides.find(s => s.no === Number(m[1]))
    if (s && (s.slug === m[2] || s.aliases?.includes(m[2])))
      return s
  }
  return slides.find(s => s.bareSlug && s.slug === r) ?? slides.find(s => s.bareAliases?.includes(r))
}

/** The slide whose card a path (relative to `base`) names: `_og/3-install.jpg` or `_og/3.jpg`. */
export function matchCard(manifest: WorkerManifest, rel: string): WorkerSlide | undefined {
  const m = rel.match(/^_og\/(\d+)(?:-([^/]+))?\.(jpg|png)$/)
  if (!m || m[3] !== manifest.card.format)
    return undefined
  const s = manifest.slides.find(s => s.no === Number(m[1]))
  if (!s || (m[2] !== undefined && m[2] !== s.slug && !s.aliases?.includes(m[2])))
    return undefined
  return s
}

function absolute(manifest: WorkerManifest, appPath: string, query = ''): string {
  // `baseUrl` is the deck's origin (+ optional path prefix); `appPath` already includes `base`.
  return `${manifest.baseUrl.replace(/\/+$/, '')}${appPath}${query ? `?${query}` : ''}`
}

/** Share info for a slide in the state `query` names (canonical, possibly empty). */
export function shareInfoFor(manifest: WorkerManifest, slide: WorkerSlide, query: string): ShareInfo {
  return {
    title: slide.title,
    description: slide.description,
    url: absolute(manifest, slide.path, query),
    image: absolute(manifest, slide.image, query ? `${query}&v=${slide.hash}` : `v=${slide.hash}`),
  }
}

/** Rewrite a slide shell's head for `info`, adding the tags it lacks before `</head>`. */
export function stampShell(response: Response, info: ShareInfo): Response {
  const tags = shareTags(info)
  const seen = new Set<string>()
  let sawCanonical = false
  const headers = new Headers(response.headers)
  // The tags vary with the query, so caches must not share one stamped copy across URLs.
  headers.set('Cache-Control', 'no-cache')
  headers.delete('ETag')
  headers.delete('Content-Length')
  const res = new Response(response.body, { status: response.status, headers })
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(htmlEscape(info.title)) } })
    .on('meta', {
      element(el) {
        const key = el.getAttribute('property') ?? el.getAttribute('name')
        const tag = key ? tags.find(t => t.key === key) : undefined
        if (!tag || seen.has(tag.key))
          return
        el.setAttribute('content', tag.value)
        seen.add(tag.key)
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute('href', info.url)
        sawCanonical = true
      },
    })
    .on('head', {
      element(el) {
        el.onEndTag((end) => {
          const missing = tags
            .filter(t => !t.ifPresent && !seen.has(t.key))
            .map(t => `<meta ${t.attr}="${t.key}" content="${htmlEscape(t.value)}">\n`)
          if (!sawCanonical)
            missing.push(`<link rel="canonical" href="${htmlEscape(info.url)}">\n`)
          if (missing.length)
            end.before(missing.join(''), { html: true })
        })
      },
    })
    .transform(res)
}

/**
 * A page with only the share tags (no SPA), for unfurlers the gate turned away. `body` is HTML
 * for its `<body>` (e.g. a sign-in prompt).
 */
export function metaOnlyShell(info: ShareInfo, body = ''): Response {
  const tags = shareTags(info)
    .filter(t => !t.ifPresent)
    .map(t => `<meta ${t.attr}="${t.key}" content="${htmlEscape(t.value)}">`)
    .join('\n')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${htmlEscape(info.title)}</title>
${tags}
<link rel="canonical" href="${htmlEscape(info.url)}">
</head>
<body>${body}</body>
</html>
`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } })
}

/** The deck URL a renderer loads for `slide` in state `query`: print mode, so no nav chrome. */
export function renderUrl(origin: string, manifest: WorkerManifest, slide: WorkerSlide, query: string): string {
  const q = new URLSearchParams(query)
  q.set('print', 'true')
  q.set('range', String(slide.no))
  return `${origin}${manifest.base.replace(/\/*$/, '/')}${slide.no}?${q}`
}

const CARD_CACHE = 'public, max-age=86400'
// Short, so cards start rendering soon after a renderer gets bound.
const FALLBACK_CACHE = 'public, max-age=300'

async function serveCard(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
  manifest: WorkerManifest,
  slide: WorkerSlide,
  options: WorkerOptions,
): Promise<Response> {
  const url = new URL(request.url)
  const query = canonicalizeParams(slide.params, url.searchParams)
  const defaultCard = () => env.ASSETS.fetch(new Request(new URL(slide.image, url.origin), { headers: request.headers }))
  if (!query)
    return defaultCard()

  const contentType = manifest.card.format === 'jpg' ? 'image/jpeg' : 'image/png'
  // Keyed on the canonical URL, so reordered / defaulted / unknown params share one entry, and a
  // new deploy (new `v`) misses.
  const cacheKey = new Request(`${url.origin}${slide.image}?${query}&v=${slide.hash}`)
  const cache = typeof caches !== 'undefined' ? caches.default : undefined
  const hit = await cache?.match(cacheKey)
  if (hit)
    return hit

  let bytes: Uint8Array | ArrayBuffer | null = null
  if (options.renderer) {
    try {
      bytes = await options.renderer({ env, slide, query, url: renderUrl(url.origin, manifest, slide, query), card: manifest.card })
    }
    catch (e) {
      console.error(`[slidev] card render failed for slide ${slide.no}?${query}:`, e)
    }
  }
  if (!bytes) {
    const fallback = await defaultCard()
    const headers = new Headers(fallback.headers)
    headers.set('Cache-Control', FALLBACK_CACHE)
    headers.set('X-Slidev-Card', 'default')
    return new Response(fallback.body, { status: fallback.status, headers })
  }
  const res = new Response(bytes as BodyInit, { headers: { 'Content-Type': contentType, 'Cache-Control': CARD_CACHE, 'X-Slidev-Card': 'rendered' } })
  if (cache)
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
}

/**
 * Mark a response the gate let through as private, so no shared cache between the Worker and the
 * browser keeps a copy for someone else. Revalidation (ETags) still works.
 */
function privatize(response: Response): Response {
  if (response.status === 101)
    return response
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'private, no-cache')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function createWorker(manifest: WorkerManifest, options: WorkerOptions = {}) {
  const base = manifest.base.replace(/\/*$/, '/')
  const unfurlers = options.unfurlers ?? UNFURLER_RE
  const publicPaths = manifest.publicPaths
  // Manifests from before `publicCards` existed had public cards.
  const publicCards = manifest.publicCards !== false
  return {
    async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url)
      const isGet = request.method === 'GET' || request.method === 'HEAD'
      const inBase = url.pathname.startsWith(base)
      if (!options.gate && (!isGet || !inBase))
        return env.ASSETS.fetch(request)
      const rel = inBase ? url.pathname.slice(base.length) : undefined
      const appPath = rel === undefined ? undefined : `/${rel}`

      const card = isGet && rel !== undefined ? matchCard(manifest, rel) : undefined
      if (card && publicCards)
        return serveCard(request, env, ctx, manifest, card, options)

      const slide = isGet && rel !== undefined ? matchSlide(manifest.slides, rel) : undefined
      const isUnfurler = unfurlers.test(request.headers.get('User-Agent') ?? '')
      const info = () => shareInfoFor(manifest, slide!, canonicalizeParams(slide!.params, url.searchParams))

      let gated = false
      if (options.gate && !(appPath !== undefined && publicPaths.some(p => matchesPathPattern(appPath, p)))) {
        const token = env.SLIDEV_RENDER_TOKEN
        const isRender = !!token && request.headers.get(RENDER_TOKEN_HEADER) === token
        if (!isRender) {
          const blocked = await options.gate(request, env, ctx, { slide, share: slide && info(), unfurler: isUnfurler, base })
          if (blocked)
            return slide && isUnfurler && publicCards ? metaOnlyShell(info()) : blocked
          gated = true
        }
      }
      const done = (res: Response | Promise<Response>) => gated ? Promise.resolve(res).then(privatize) : res

      if (card)
        return done(serveCard(request, env, ctx, manifest, card, options))
      if (slide && (manifest.alwaysStamp || isUnfurler)) {
        // Unconditional: a 304 for the unstamped file says nothing about the stamped one.
        const headers = new Headers(request.headers)
        headers.delete('If-None-Match')
        headers.delete('If-Modified-Since')
        const shell = await env.ASSETS.fetch(new Request(new URL(slide.path, url.origin), { headers }))
        if (shell.ok && (shell.headers.get('Content-Type') ?? '').includes('text/html'))
          return done(stampShell(shell, info()))
        return done(shell)
      }
      return done(env.ASSETS.fetch(request))
    },
  }
}

/** The subset of `@cloudflare/puppeteer` the browser renderer uses. */
export interface PuppeteerLike {
  launch: (binding: any) => Promise<{
    newPage: () => Promise<{
      setViewport: (v: { width: number, height: number }) => Promise<void>
      setExtraHTTPHeaders: (headers: Record<string, string>) => Promise<void>
      goto: (url: string, options: { waitUntil: string, timeout: number }) => Promise<unknown>
      waitForSelector: (selector: string, options: { timeout: number }) => Promise<{
        screenshot: (options: { type: 'jpeg' | 'png', quality?: number }) => Promise<Uint8Array>
      } | null>
      waitForFunction: (fn: () => boolean, options: { timeout: number }) => Promise<unknown>
    }>
    close: () => Promise<void>
  }>
}

/**
 * Option (a) of the spec: load the slide in print mode in Cloudflare Browser Rendering and
 * screenshot it at the card size. Needs a `browser` binding (`BROWSER` by default); without it,
 * the card falls back to the pre-rendered default.
 */
export function browserRenderer(puppeteer: PuppeteerLike, { binding = 'BROWSER', timeout = 20000 } = {}): CardRenderer {
  return async ({ env, slide, url, card }) => {
    const browserBinding = env[binding]
    if (!browserBinding)
      return null
    const browser = await puppeteer.launch(browserBinding)
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: card.size[0], height: card.size[1] })
      if (env.SLIDEV_RENDER_TOKEN)
        await page.setExtraHTTPHeaders({ [RENDER_TOKEN_HEADER]: env.SLIDEV_RENDER_TOKEN })
      await page.goto(url, { waitUntil: 'load', timeout })
      const el = await page.waitForSelector(`[data-slidev-no="${slide.no}"]`, { timeout })
      if (!el)
        return null
      // Same readiness signal the build-time export waits for.
      await page.waitForFunction(() => !document.querySelector('.slidev-slide-loading'), { timeout })
      return await el.screenshot(card.format === 'jpg' ? { type: 'jpeg', quality: card.quality } : { type: 'png' })
    }
    finally {
      await browser.close()
    }
  }
}
