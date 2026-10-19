// The Worker `slidev build --worker --auth open-athena` emits, in workerd (via Miniflare) with a
// local D1: the generated entry is bundled with esbuild (as wrangler does) against the installed
// `@open-athena/auth`, the library's migrations are applied, and sessions / share links are minted
// with a secret generated per run. `env.ASSETS` is a Node function standing in for Workers assets.
// Needs `@slidev/cli` built (`dist/og-worker.js`), like `og-worker-miniflare.test.ts`.
import type { WorkerBundleAuth } from '../packages/slidev/node/commands/og'
import type { WorkerManifest } from '../packages/slidev/node/worker/runtime'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { createGate, signSession } from '@open-athena/auth'
import { d1GrantStore } from '@open-athena/auth/d1'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AUTH_PUBLIC_PATHS, AUTH_WORKER_ENTRY, buildWorkerManifest, injectPerSlideMeta, renderWranglerConfig, writeWorkerBundle } from '../packages/slidev/node/commands/og'
import { signInBody } from '../packages/slidev/node/worker/auth'
import { normalizeSlideParams } from '../packages/slidev/node/worker/shared'

const BASE_URL = 'https://deck.example'
const SLACK_UA = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const AUTH_PKG = resolve('node_modules/@open-athena/auth')
// Generated per run; never a fixed value in the repo.
const SECRET = randomBytes(32).toString('base64url')
const TITLE = 'Deep Dive'

const SPA_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Deck</title>
<meta property="og:title" content="Deck">
<meta property="og:image" content="${BASE_URL}/_og/1-intro.jpg">
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/assets/index.css">
<link rel="modulepreload" href="/assets/vendor.js">
<script type="module" src="/assets/index.js"></script>
<style>body{margin:0}</style>
</head>
<body><div id="app"></div><noscript>JS needed</noscript></body>
</html>
`
const APP_JS = 'console.log("the deck")\n'

const plans = [
  { no: 1, slug: 'intro', title: 'Intro', description: 'First slide', params: {} },
  { no: 2, slug: 'chart', title: 'Branch harmony', description: 'Bubbles vs heatmap', params: normalizeSlideParams({ m: ['bubbles', 'heatmap'] }).params },
].map(p => ({
  ...p,
  appPath: `/${p.no}-${p.slug}`,
  imageAppPath: `/_og/${p.no}-${p.slug}.jpg`,
  contentHash: `hash${p.no}`,
  canonical: `${BASE_URL}/${p.no}-${p.slug}`,
  imageUrl: `${BASE_URL}/_og/${p.no}-${p.slug}.jpg`,
}))

const card = (no: number) => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, no, ...Array.from({ length: 512 }, (_, i) => (i * 7 + no) % 256)])

function manifestFor(publicCards: boolean): WorkerManifest {
  return buildWorkerManifest(plans, {
    baseUrl: BASE_URL,
    appBase: '/',
    alwaysStamp: false,
    publicPaths: AUTH_PUBLIC_PATHS,
    publicCards,
    card: { size: [1200, 675], format: 'jpg', quality: 85 },
    hasBareSlug: () => true,
  })
}

function authConfig(migrationsDir: string): WorkerBundleAuth {
  return {
    provider: 'open-athena',
    staffDomains: ['openathena.ai'],
    admins: ['boss@example.org'],
    scope: 'deck',
    title: TITLE,
    database: 'deck-auth',
    migrationsDir,
  }
}

interface Deck { dir: string, workerDir: string, mf: Miniflare }

function serveAssets(dir: string) {
  return (request: Request): Response => {
    const path = decodeURIComponent(new URL(request.url).pathname)
    const candidates = path.endsWith('/') ? [`${path}index.html`] : [path, `${path}.html`]
    const hit = candidates.map(c => join(dir, c)).find(f => existsSync(f) && !f.endsWith('/'))
    const file = hit ?? join(dir, 'index.html')
    const type = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.js': 'text/javascript' }[extname(file)] ?? 'application/octet-stream'
    return new Response(readFileSync(file), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=0, must-revalidate' } })
  }
}

/** The library's migrations, as single statements. */
function migrationStatements(): string[] {
  const dir = join(AUTH_PKG, 'migrations')
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().flatMap(f => readFileSync(join(dir, f), 'utf-8').replace(/--.*$/gm, '').split(';')).map(s => s.trim()).filter(Boolean)
}

const roots: string[] = []

/** A synthetic build output plus its auth Worker, bundled and running. */
async function makeDeck(publicCards: boolean, bindings: Record<string, string>): Promise<Deck> {
  const root = mkdtempSync(join(tmpdir(), 'slidev-og-worker-auth-'))
  roots.push(root)
  const dir = join(root, 'dist')
  const workerDir = join(root, 'dist-worker')
  mkdirSync(join(dir, '_og'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'index.html'), SPA_SHELL)
  writeFileSync(join(dir, 'assets', 'index.js'), APP_JS)
  for (const p of plans) {
    const shell = injectPerSlideMeta(SPA_SHELL, p)
    writeFileSync(join(dir, `${p.no}.html`), shell)
    writeFileSync(join(dir, `${p.no}-${p.slug}.html`), shell)
    writeFileSync(join(dir, '_og', `${p.no}-${p.slug}.jpg`), card(p.no))
  }
  await writeWorkerBundle(dir, manifestFor(publicCards), { name: 'deck', renderer: 'none', baseUrl: BASE_URL, auth: authConfig(join(AUTH_PKG, 'migrations')) })
  // What wrangler does with the entry: bundle it, resolving `@open-athena/auth` from node_modules.
  await build({
    entryPoints: [join(workerDir, 'index.js')],
    outfile: join(workerDir, 'bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['module', 'main'],
    nodePaths: [resolve('node_modules')],
    logLevel: 'silent',
  })
  const mf = new Miniflare({
    modules: true,
    scriptPath: join(workerDir, 'bundle.js'),
    modulesRoot: workerDir,
    compatibilityDate: '2026-07-01',
    bindings,
    d1Databases: ['DB'],
    serviceBindings: { ASSETS: serveAssets(dir) as any },
  })
  const db = await mf.getD1Database('DB')
  await db.batch(migrationStatements().map(s => db.prepare(s)))
  return { dir, workerDir, mf }
}

const VARS = { SESSION_SECRET: SECRET, STAFF_DOMAIN: 'openathena.ai', ADMIN_EMAILS: 'boss@example.org' }

function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', '#39': '\'' })[e]!)
}

function shareTagsOf(html: string): [string, string][] {
  const out: [string, string][] = []
  const re = /<title>([^<]*)<\/title>|<meta (?:name|property)="([^"]+)" content="([^"]*)">|<link rel="canonical" href="([^"]*)">/g
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined)
      out.push(['title', unescapeHtml(m[1])])
    else if (m[2] !== undefined)
      out.push([m[2], unescapeHtml(m[3])])
    else
      out.push(['canonical', unescapeHtml(m[4])])
  }
  return out
}

/** The tags of the meta-only page, in its order. */
function metaOnlyTags(title: string, description: string, url: string, image: string): [string, string][] {
  return [
    ['title', title],
    ['description', description],
    ['og:type', 'website'],
    ['og:title', title],
    ['og:description', description],
    ['og:image', image],
    ['og:url', url],
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', title],
    ['twitter:description', description],
    ['twitter:image', image],
    ['canonical', url],
  ]
}

const bodyOf = (html: string) => html.match(/<body>([\s\S]*)<\/body>/)?.[1]

async function bytesOf(res: { arrayBuffer: () => Promise<ArrayBuffer> }) {
  return new Uint8Array(await res.arrayBuffer())
}

afterAll(() => {
  for (const root of roots)
    rmSync(root, { recursive: true, force: true })
})

describe('generated bundle', () => {
  it('writes the auth entry and a wrangler template with D1, vars and the migrations', () => {
    const root = mkdtempSync(join(tmpdir(), 'slidev-og-worker-auth-'))
    roots.push(root)
    const auth = authConfig('../node_modules/@open-athena/auth/migrations')
    const wrangler = renderWranglerConfig('deck', 'none', '../dist', auth)
    expect(JSON.parse(wrangler.replace(/^\s*\/\/.*$/gm, ''))).toEqual({
      name: 'deck',
      main: 'index.js',
      compatibility_date: '2026-07-01',
      assets: {
        directory: '../dist',
        binding: 'ASSETS',
        run_worker_first: true,
        html_handling: 'auto-trailing-slash',
        not_found_handling: 'single-page-application',
      },
      d1_databases: [{
        binding: 'DB',
        database_name: 'deck-auth',
        database_id: 'set-by-slidev-deploy',
        migrations_dir: '../node_modules/@open-athena/auth/migrations',
      }],
      vars: { STAFF_DOMAIN: 'openathena.ai', ADMIN_EMAILS: 'boss@example.org' },
    })
    expect(JSON.parse(renderWranglerConfig('deck', 'none', '../dist', { ...auth, databaseId: 'abc-123' }).replace(/^\s*\/\/.*$/gm, '')).d1_databases[0].database_id)
      .toBe('abc-123')
  })
})

describe('auth Worker', () => {
  let deck: Deck
  let mf: Miniflare
  beforeAll(async () => {
    deck = await makeDeck(true, VARS)
    mf = deck.mf
  }, 30000)
  afterAll(() => mf.dispose())

  const get = (path: string, headers: Record<string, string> = {}) =>
    mf.dispatchFetch(`${BASE_URL}${path}`, { headers: { 'User-Agent': BROWSER_UA, ...headers }, redirect: 'manual' })
  const cookieFor = async (email: string) => `oa_auth=${await signSession(`e:${email}`, SECRET, Date.now())}`
  const mint = async () => {
    const gate = createGate({ store: d1GrantStore(await mf.getD1Database('DB') as any), secret: SECRET })
    return gate.mint({ name: 'Reviewer', scopes: ['deck'], createdBy: 'boss@example.org' })
  }
  const grantRedeems = async (id: string) =>
    (await (await mf.getD1Database('DB')).prepare('SELECT redeems FROM grants WHERE id = ?').bind(id).first<{ redeems: number }>())?.redeems

  it('writes the auth entry', () => {
    expect(readFileSync(join(deck.workerDir, 'index.js'), 'utf-8')).toBe(AUTH_WORKER_ENTRY)
  })

  it('gives an anonymous browser a slide\'s share tags and a sign-in prompt, with no scripts', async () => {
    const res = await get('/2-chart')
    const html = await res.text()
    expect([res.status, res.headers.get('Content-Type'), res.headers.get('Cache-Control'), res.headers.get('X-Robots-Tag')])
      .toEqual([200, 'text/html; charset=utf-8', 'no-store', 'noindex'])
    expect(shareTagsOf(html)).toEqual(metaOnlyTags('Branch harmony', 'Bubbles vs heatmap', `${BASE_URL}/2-chart`, `${BASE_URL}/_og/2-chart.jpg?v=hash2`))
    expect(bodyOf(html)).toBe(signInBody({ title: TITLE, base: '/', next: '/2-chart', google: false }))
    expect(html.includes('<script')).toBe(false)
  })

  it('gives an anonymous unfurler the slide\'s tags for its URL state', async () => {
    const res = await get('/2?m=heatmap', { 'User-Agent': SLACK_UA })
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(shareTagsOf(html)).toEqual(metaOnlyTags('Branch harmony', 'Bubbles vs heatmap', `${BASE_URL}/2-chart?m=heatmap`, `${BASE_URL}/_og/2-chart.jpg?m=heatmap&v=hash2`))
    expect(html.includes('<script')).toBe(false)
  })

  it('serves cards and favicons anonymously', async () => {
    const res = await get('/_og/2-chart.jpg', { 'User-Agent': SLACK_UA })
    expect([res.status, res.headers.get('Content-Type'), await bytesOf(res)]).toEqual([200, 'image/jpeg', card(2)])
  })

  it('strips every script and stylesheet from other anonymous pages', async () => {
    const res = await get('/')
    expect([res.status, res.headers.get('Cache-Control')]).toEqual([200, 'no-store'])
    expect((await res.text()).split('\n')).toEqual([
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8">',
      '<title>Deck</title>',
      '<meta property="og:title" content="Deck">',
      `<meta property="og:image" content="${BASE_URL}/_og/1-intro.jpg">`,
      '<link rel="icon" href="/favicon.svg">',
      '',
      '',
      '',
      '',
      '</head>',
      ...`<body>${signInBody({ title: TITLE, base: '/', next: '/', google: false })}</body>`.split('\n'),
      '</html>',
      '',
    ])
  })

  it('refuses anonymous asset requests', async () => {
    const res = await get('/assets/index.js')
    expect([res.status, await res.text()]).toEqual([401, 'Sign in required\n'])
  })

  it('serves everything to a staff session, privately', async () => {
    const cookie = await cookieFor('alice@openathena.ai')
    const page = await get('/', { Cookie: cookie })
    expect([page.status, page.headers.get('Cache-Control'), await page.text()]).toEqual([200, 'private, no-cache', SPA_SHELL])
    const js = await get('/assets/index.js', { Cookie: cookie })
    expect([js.status, await js.text()]).toEqual([200, APP_JS])
  })

  it('lets admins in, and treats other accounts as anonymous', async () => {
    const admin = await get('/assets/index.js', { Cookie: await cookieFor('boss@example.org') })
    expect([admin.status, await admin.text()]).toEqual([200, APP_JS])
    const outsider = await get('/assets/index.js', { Cookie: await cookieFor('eve@elsewhere.test') })
    expect(outsider.status).toBe(401)
    const forged = await get('/assets/index.js', { Cookie: `oa_auth=${await signSession('e:alice@openathena.ai', 'not-the-secret', Date.now())}` })
    expect(forged.status).toBe(401)
  })

  it('routes the library\'s API, for any method', async () => {
    const anon = await get('/api/auth/whoami')
    expect([anon.status, await anon.json()]).toEqual([401, { error: 'unauthenticated' }])
    const me = await get('/api/auth/whoami', { Cookie: await cookieFor('alice@openathena.ai') })
    expect([me.status, await me.json()]).toEqual([200, { kind: 'sso', email: 'alice@openathena.ai', admin: false, scopes: ['deck'], subject: null }])
    const logout = await mf.dispatchFetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: { Cookie: await cookieFor('alice@openathena.ai') } })
    expect([logout.status, await logout.json()]).toEqual([200, { ok: true }])
  })

  it('redeems a share link for a session cookie, and reloads without the key', async () => {
    const { grant, token } = await mint()
    const res = await get(`/2-chart?m=heatmap&key=${token}`)
    const cookie = res.headers.get('Set-Cookie')!
    expect([res.status, res.headers.get('Location'), res.headers.get('Cache-Control')]).toEqual([302, '/2-chart?m=heatmap', 'no-store'])
    expect(cookie.replace(/^oa_auth=[\w-]+\.[\w-]+;/, 'oa_auth=<session>;')).toBe('oa_auth=<session>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000')
    const js = await get('/assets/index.js', { Cookie: cookie.split(';')[0] })
    expect([js.status, await js.text()]).toEqual([200, APP_JS])
    expect(await grantRedeems(grant.id)).toBe(1)
  })

  it('lets an unfurler with a share link through, without spending a redemption', async () => {
    const { grant, token } = await mint()
    // The library authenticates a `?key=` per request; only redeeming mints a session.
    const res = await get(`/2-chart?key=${token}`, { 'User-Agent': SLACK_UA })
    expect([res.status, res.headers.get('Set-Cookie'), res.headers.get('Cache-Control')]).toEqual([200, null, 'private, no-cache'])
    // The stamped shell (in its own tag order), whose URLs never carry the key.
    expect(shareTagsOf(await res.text())).toEqual([
      ['title', 'Branch harmony'],
      ['og:title', 'Branch harmony'],
      ['og:image', `${BASE_URL}/_og/2-chart.jpg?v=hash2`],
      ['description', 'Bubbles vs heatmap'],
      ['og:type', 'website'],
      ['og:description', 'Bubbles vs heatmap'],
      ['og:url', `${BASE_URL}/2-chart`],
      ['twitter:card', 'summary_large_image'],
      ['twitter:title', 'Branch harmony'],
      ['twitter:description', 'Bubbles vs heatmap'],
      ['twitter:image', `${BASE_URL}/_og/2-chart.jpg?v=hash2`],
      ['canonical', `${BASE_URL}/2-chart`],
    ])
    expect(await grantRedeems(grant.id)).toBe(0)
  })

  it('mints a link through the API for an admin, which lands on its slide', async () => {
    const admin = await cookieFor('boss@example.org')
    const res = await mf.dispatchFetch(`${BASE_URL}/api/auth/grants`, {
      method: 'POST',
      headers: { 'Cookie': admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopes: ['deck'], subjectName: 'Rae', email: null, note: 'review', avatar: null, maxRedeems: null, expiresInS: 86400, allowlist: false }),
    })
    const { grant, token } = await res.json() as { grant: any, token: string }
    expect([res.status, grant.subject, grant.note, grant.scopes, grant.createdBy, grant.expiresAt - grant.createdAt, typeof token])
      .toEqual([200, { name: 'Rae' }, 'review', ['deck'], 'boss@example.org', 86400, 'string'])
    // The URL "Get link" builds: the slide's canonical path, its query, and the key.
    const landing = await get(`/2-chart?m=heatmap&key=${token}`)
    expect([landing.status, landing.headers.get('Location')]).toEqual([302, '/2-chart?m=heatmap'])
    const page = await get('/2-chart?m=heatmap', { Cookie: landing.headers.get('Set-Cookie')!.split(';')[0] })
    expect(page.status).toBe(200)
    // The links table: listed with one use, then revoked.
    const list = await (await get('/api/auth/grants', { Cookie: admin })).json() as { grants: any[] }
    expect(list.grants.find(g => g.id === grant.id)?.redeems).toBe(1)
    const activity = await get(`/api/auth/grants/${grant.id}/activity`, { Cookie: admin })
    expect([activity.status, ((await activity.json()) as any).grantId]).toEqual([200, grant.id])
    const revoke = await mf.dispatchFetch(`${BASE_URL}/api/auth/grants/${grant.id}/revoke`, { method: 'POST', headers: { Cookie: admin } })
    expect([revoke.status, await revoke.json()]).toEqual([200, { ok: true }])
    const after = await get(`/2-chart?key=${token}`)
    expect([after.status, bodyOf(await after.text())])
      .toEqual([200, signInBody({ title: TITLE, base: '/', next: '/2-chart', google: false, notice: 'That share link has been revoked.' })])
  })

  it('refuses to mint for a staff account (403) or anonymously (401)', async () => {
    const mintAs = async (headers: Record<string, string>) => {
      const res = await mf.dispatchFetch(`${BASE_URL}/api/auth/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ scopes: ['deck'] }),
      })
      return [res.status, await res.json()]
    }
    expect(await mintAs({ Cookie: await cookieFor('alice@openathena.ai') })).toEqual([403, { error: 'forbidden' }])
    expect(await mintAs({})).toEqual([401, { error: 'unauthenticated' }])
  })

  it('says why a share link didn\'t work', async () => {
    const res = await get('/2-chart?key=bogus')
    expect([res.status, bodyOf(await res.text())])
      .toEqual([200, signInBody({ title: TITLE, base: '/', next: '/2-chart', google: false, notice: 'That share link isn\'t valid.' })])
  })
})

describe('auth Worker with `DEV_ADMIN_EMAIL` (`wrangler dev`)', () => {
  let deck: Deck
  beforeAll(async () => {
    deck = await makeDeck(true, { ...VARS, DEV_ADMIN_EMAIL: 'boss@example.org' })
  }, 30000)
  afterAll(() => deck.mf.dispose())

  const cookieShape = (c: string | null) => c?.replace(/^oa_auth=[\w-]+\.[\w-]+;/, 'oa_auth=<session>;')

  it('signs localhost requests in as that admin', async () => {
    for (const origin of ['http://localhost:8787', 'http://127.0.0.1:8787']) {
      const me = await deck.mf.dispatchFetch(`${origin}/api/auth/whoami`)
      expect([me.status, await me.json(), cookieShape(me.headers.get('Set-Cookie'))])
        .toEqual([200, { kind: 'sso', email: 'boss@example.org', admin: true, scopes: ['*'], subject: null }, 'oa_auth=<session>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000'])
    }
    // A page reloads with the cookie; with it, nothing more is set.
    const page = await deck.mf.dispatchFetch('http://localhost:8787/2-chart?m=heatmap', { redirect: 'manual' })
    const cookie = page.headers.get('Set-Cookie')!
    expect([page.status, page.headers.get('Location'), cookieShape(cookie)]).toEqual([302, '/2-chart?m=heatmap', 'oa_auth=<session>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000'])
    const again = await deck.mf.dispatchFetch('http://localhost:8787/2-chart?m=heatmap', { headers: { Cookie: cookie.split(';')[0] }, redirect: 'manual' })
    expect([again.status, again.headers.get('Set-Cookie')]).toEqual([200, null])
    // Admin routes answer within the same request.
    const mint = await deck.mf.dispatchFetch('http://localhost:8787/api/auth/grants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopes: ['deck'], subjectName: 'Rae', avatar: null }),
    })
    expect([mint.status, ((await mint.json()) as any).grant.createdBy]).toEqual([200, 'boss@example.org'])
  })

  it('never signs in a request that isn\'t to localhost', async () => {
    const me = await deck.mf.dispatchFetch(`${BASE_URL}/api/auth/whoami`)
    expect([me.status, await me.json(), me.headers.get('Set-Cookie')]).toEqual([401, { error: 'unauthenticated' }, null])
    const js = await deck.mf.dispatchFetch(`${BASE_URL}/assets/index.js`)
    expect(js.status).toBe(401)
    const spoofed = await deck.mf.dispatchFetch(`${BASE_URL}/api/auth/whoami`, { headers: { 'Host': 'localhost', 'X-Forwarded-Host': 'localhost' } })
    expect([spoofed.status, spoofed.headers.get('Set-Cookie')]).toEqual([401, null])
  })
})

describe('auth Worker with Google configured', () => {
  let deck: Deck
  beforeAll(async () => {
    deck = await makeDeck(true, { ...VARS, GOOGLE_CLIENT_ID: 'client-id.test', GOOGLE_CLIENT_SECRET: randomBytes(16).toString('hex') })
  }, 30000)
  afterAll(() => deck.mf.dispose())

  it('offers Google sign-in, and starts the flow at `/auth/google`', async () => {
    const page = await deck.mf.dispatchFetch(`${BASE_URL}/2-chart?m=heatmap`)
    expect(bodyOf(await page.text())).toBe(signInBody({ title: TITLE, base: '/', next: '/2-chart?m=heatmap', google: true }))
    const start = await deck.mf.dispatchFetch(`${BASE_URL}/auth/google?next=%2F2-chart`, { redirect: 'manual' })
    const location = new URL(start.headers.get('Location')!)
    expect([start.status, location.origin + location.pathname, location.searchParams.get('client_id'), location.searchParams.get('redirect_uri')])
      .toEqual([302, 'https://accounts.google.com/o/oauth2/v2/auth', 'client-id.test', `${BASE_URL}/auth/google/callback`])
  })
})

describe('auth Worker with `publicOg: false`', () => {
  let deck: Deck
  beforeAll(async () => {
    deck = await makeDeck(false, VARS)
  }, 30000)
  afterAll(() => deck.mf.dispose())

  const get = (path: string, ua = SLACK_UA) => deck.mf.dispatchFetch(`${BASE_URL}${path}`, { headers: { 'User-Agent': ua } })

  it('gates the cards', async () => {
    const res = await get('/_og/2-chart.jpg')
    expect(res.status).toBe(401)
  })

  it('gives anonymous slide requests the deck\'s page, with no share tags', async () => {
    for (const ua of [SLACK_UA, BROWSER_UA]) {
      const html = await (await get('/2-chart', ua)).text()
      expect([shareTagsOf(html), bodyOf(html)]).toEqual([[['title', 'Deck']], signInBody({ title: TITLE, base: '/', next: '/2-chart', google: false })])
    }
  })
})

describe('auth Worker without its secret', () => {
  let deck: Deck
  beforeAll(async () => {
    deck = await makeDeck(true, { STAFF_DOMAIN: 'openathena.ai', ADMIN_EMAILS: '' })
  }, 30000)
  afterAll(() => deck.mf.dispose())

  it('fails closed', async () => {
    const res = await deck.mf.dispatchFetch(`${BASE_URL}/assets/index.js`)
    expect([res.status, await res.text()]).toEqual([503, 'Auth isn\'t configured: set `SESSION_SECRET` (a secret); `slidev deploy` sets it up.\n'])
  })

  it('still serves the cards', async () => {
    const res = await deck.mf.dispatchFetch(`${BASE_URL}/_og/1-intro.jpg`)
    expect([res.status, await bytesOf(res)]).toEqual([200, card(1)])
  })
})
