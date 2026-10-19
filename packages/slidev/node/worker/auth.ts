// The `@open-athena/auth` gate for the Worker deploy target (`publish.worker.auth: open-athena`).
// Bundled into the same Worker runtime as `runtime.ts`, so it must stay free of Node APIs and npm
// imports too: the generated entry imports `@open-athena/auth` from the deck's `node_modules` and
// passes its functions in as `lib` (as it does `@cloudflare/puppeteer` for the renderer).
//
// What it adds in front of `createWorker` (see specs/done/worker-auth-deploy.md):
// - `<base>auth/google{,/callback}`: Google sign-in, when `GOOGLE_CLIENT_ID` / `_SECRET` are set;
// - `<base>api/auth/*`: the library's routes (whoami, logout, admin: mint / revoke share links);
// - `?key=<token>` (a share link): redeemed for a session cookie, then reloaded without the key;
// - signed in with the deck's scope (`STAFF_DOMAIN` accounts, the D1 allowlist, `ADMIN_EMAILS`):
//   everything, as `createWorker` serves it;
// - anonymous: a slide URL gets its share tags and a sign-in prompt (no scripts or styles), other
//   pages get their HTML with every script / stylesheet stripped and the body replaced by the
//   prompt, and anything else is a 401. Cards stay public while `publicCards`.

import type { CardRenderer, Gate, GateInfo, WorkerEnv, WorkerManifest } from './runtime'
import { createWorker, metaOnlyShell } from './runtime'
import { htmlEscape } from './shared'

/** What the deck's build config says about auth (`deck.js`'s `auth`). */
export interface AuthOptions {
  provider: 'open-athena'
  /** The scope a session needs to see the deck. */
  scope: string
  /** Shown on the sign-in page. */
  title: string
}

/** The `@open-athena/auth` functions the gate uses, passed in by the generated entry. */
export interface AuthLib {
  createGate: (opts: any) => AuthGate
  authRoutes: (gate: AuthGate, opts: any) => (req: Request) => Promise<Response | null>
  domainPolicy: (domains: readonly string[], scopes: readonly string[]) => unknown
  allowlistPolicy: (store: unknown, opts?: { scopes?: readonly string[] }) => unknown
  firstMatch: (...policies: any[]) => unknown
  hasScope: (auth: any, scope: string) => boolean
  d1GrantStore: (db: unknown) => unknown
  d1RequestStore: (db: unknown) => unknown
  d1AuditSink: (db: unknown) => unknown
  d1AuditQuery: (db: unknown) => unknown
  d1Allowlist: (db: unknown) => unknown
  oidcStart: (opts: any) => (ctx: { request: Request }) => Promise<Response>
  oidcCallback: (opts: any) => (ctx: { request: Request }) => Promise<Response>
  GOOGLE: unknown
}

interface AuthGate {
  authenticate: (req: Request) => Promise<unknown | null>
  redeem: (token: string, req: Request) => Promise<{ ok: true, cookie: string } | { ok: false, reason: string }>
}

export interface AuthEnv extends WorkerEnv {
  DB?: unknown
  SESSION_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** Comma-separated email domains whose accounts get the deck's scope. */
  STAFF_DOMAIN?: string
  /** Comma-separated addresses that always get in (and may mint share links). */
  ADMIN_EMAILS?: string
}

export interface AuthWorkerOptions {
  renderer?: CardRenderer
  auth: AuthOptions
  lib: AuthLib
  unfurlers?: RegExp
}

const list = (s: string | undefined) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean)

const REDEEM_FAILURES: Record<string, string> = {
  'bad-token': 'That share link isn\'t valid.',
  'revoked': 'That share link has been revoked.',
  'disabled': 'That share link has been turned off.',
  'expired': 'That share link has expired.',
  'exhausted': 'That share link has been used up.',
}

/** The sign-in prompt that replaces an anonymous page's body. */
export function signInBody(opts: { title: string, base: string, next: string, google: boolean, notice?: string }): string {
  const { title, base, next, google, notice } = opts
  const action = google
    ? `<a href="${htmlEscape(`${base}auth/google?next=${encodeURIComponent(next)}`)}" style="display:inline-block;padding:.6rem 1.2rem;border-radius:6px;background:#333;color:#fff;text-decoration:none">Sign in with Google</a>`
    : `<p>Sign-in isn't configured yet; use a share link.</p>`
  return `<main style="font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1rem;text-align:center;color:#333">
<h1 style="font-size:1.4rem;margin:0 0 .5rem">${htmlEscape(title)}</h1>
<p style="margin:0 0 1.5rem;opacity:.75">Sign in to view this deck.</p>
${notice ? `<p style="color:#b3261e">${htmlEscape(notice)}</p>\n` : ''}${action}
</main>`
}

const ANON_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

// What an anonymous page keeps: its `<head>` metadata, never the deck's code or styles.
const STRIP = 'script, noscript, style, link[rel="modulepreload"], link[rel="stylesheet"], link[rel="preload"], link[rel="prefetch"], meta[http-equiv="refresh"]'
// Without public cards, no share tags either.
const SHARE_META = 'meta[property^="og:"], meta[name^="og:"], meta[property^="twitter:"], meta[name^="twitter:"]'

interface RewriterElement {
  remove: () => void
  setInnerContent: (content: string, options?: { html: boolean }) => void
}
interface Rewriter {
  on: (selector: string, handlers: { element: (el: RewriterElement) => void }) => Rewriter
  transform: (response: Response) => Response
}
declare const HTMLRewriter: { new (): Rewriter }

async function anonymousPage(request: Request, env: AuthEnv, base: string, body: string, publicCards: boolean): Promise<Response> {
  const url = new URL(request.url)
  const htmlOf = (path: string) => env.ASSETS.fetch(new Request(new URL(path, url.origin), { headers: { Accept: 'text/html' } }))
  // Without public cards, a slide's own shell would still give its title away.
  let page = publicCards ? await htmlOf(url.pathname) : undefined
  if (!page?.ok || !(page.headers.get('Content-Type') ?? '').includes('text/html'))
    page = await htmlOf(base)
  let rewriter = new HTMLRewriter().on(STRIP, { element: el => el.remove() })
  if (!publicCards)
    rewriter = rewriter.on(SHARE_META, { element: el => el.remove() })
  rewriter = rewriter.on('body', { element: el => el.setInnerContent(body, { html: true }) })
  const out = rewriter.transform(new Response(page.body, { headers: page.headers }))
  return new Response(out.body, { status: 200, headers: ANON_HEADERS })
}

/** The last path segment has no file extension: a page, not an asset. */
function isPagePath(pathname: string): boolean {
  return !/\.[a-z0-9]+$/i.test(pathname.slice(pathname.lastIndexOf('/') + 1))
}

/** The `gate` hook for `createWorker`, built on `@open-athena/auth`. */
export function authGate(manifest: WorkerManifest, { auth, lib }: Pick<AuthWorkerOptions, 'auth' | 'lib'>): Gate {
  const publicCards = manifest.publicCards !== false
  return async (request, workerEnv, _ctx, info: GateInfo) => {
    const env = workerEnv as AuthEnv
    const { base } = info
    if (!env.SESSION_SECRET || !env.DB) {
      // Fail closed: without a secret or a database there's no way to tell who's who.
      const missing = [!env.SESSION_SECRET && '`SESSION_SECRET` (a secret)', !env.DB && '`DB` (a D1 binding)'].filter(Boolean).join(' and ')
      return new Response(`Auth isn't configured: set ${missing}; \`slidev deploy\` sets it up.\n`, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    const url = new URL(request.url)
    const db = env.DB
    const gate = lib.createGate({
      store: lib.d1GrantStore(db),
      requests: lib.d1RequestStore(db),
      audit: lib.d1AuditSink(db),
      secret: env.SESSION_SECRET,
      adminEmails: list(env.ADMIN_EMAILS),
      policy: lib.firstMatch(
        lib.domainPolicy(list(env.STAFF_DOMAIN), [auth.scope]),
        lib.allowlistPolicy(lib.d1Allowlist(db), { scopes: [auth.scope] }),
      ),
    })

    const google = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    if (google && (url.pathname === `${base}auth/google` || url.pathname === `${base}auth/google/callback`)) {
      const oidc = {
        gate,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: `${url.origin}${base}auth/google/callback`,
        provider: lib.GOOGLE,
      }
      return url.pathname.endsWith('/callback') ? lib.oidcCallback(oidc)({ request }) : lib.oidcStart(oidc)({ request })
    }
    const apiBase = `${base}api/auth`
    if (url.pathname === apiBase || url.pathname.startsWith(`${apiBase}/`)) {
      const res = await lib.authRoutes(gate, { basePath: apiBase, audit: lib.d1AuditQuery(db), allowlist: lib.d1Allowlist(db) })(request)
      if (res)
        return res
    }

    const isGet = request.method === 'GET' || request.method === 'HEAD'
    let notice: string | undefined
    const key = url.searchParams.get('key')
    // Unfurlers don't redeem: they'd spend a capped link's redemptions, and can't keep a cookie.
    if (key && isGet && !info.unfurler) {
      const res = await gate.redeem(key, request)
      url.searchParams.delete('key')
      if (res.ok)
        return new Response(null, { status: 302, headers: { 'Location': url.pathname + url.search, 'Set-Cookie': res.cookie, 'Cache-Control': 'no-store' } })
      notice = REDEEM_FAILURES[res.reason] ?? 'That share link didn\'t work.'
    }

    const session = await gate.authenticate(request)
    if (session && lib.hasScope(session, auth.scope))
      return undefined

    const denied = url.searchParams.get('denied')
    if (denied)
      notice = `${denied} isn't on the list for this deck.`
    if (!isGet || !isPagePath(url.pathname))
      return new Response('Sign in required\n', { status: 401, headers: { 'Cache-Control': 'no-store' } })
    url.searchParams.delete('denied')
    const body = signInBody({ title: auth.title, base, next: url.pathname + url.search, google, notice })
    if (info.share && publicCards) {
      const page = metaOnlyShell(info.share, body)
      return new Response(page.body, { status: 200, headers: ANON_HEADERS })
    }
    return anonymousPage(request, env, base, body, publicCards)
  }
}

/** `createWorker` behind `@open-athena/auth`: the entry `slidev build --worker --auth open-athena` writes. */
export function createAuthWorker(manifest: WorkerManifest, options: AuthWorkerOptions) {
  return createWorker(manifest, {
    renderer: options.renderer,
    unfurlers: options.unfurlers,
    gate: authGate(manifest, options),
  })
}
