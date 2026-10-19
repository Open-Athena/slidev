// Runs the Worker that `slidev build --worker` emits in workerd (via Miniflare), against a small
// synthetic build output. `env.ASSETS` is a Node function standing in for Workers static assets
// (`html_handling: auto-trailing-slash`, `not_found_handling: single-page-application`).
// Needs `@slidev/cli` built (`dist/og-worker.js`), like `api-snapshots.test.ts`.
import type { WorkerManifest } from '../packages/slidev/node/worker/runtime'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildWorkerManifest, injectPerSlideMeta, renderWorkerDeck, WORKER_ENTRY, writeWorkerBundle } from '../packages/slidev/node/commands/og'
import { normalizeSlideParams } from '../packages/slidev/node/worker/shared'

const BASE_URL = 'https://deck.example'
const SLACK_UA = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

// The SPA shell, as `setups/indexHtml.ts` emits it for a deck without `seoMeta`.
const SPA_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Deck</title>
<meta property="og:title" content="Deck">
<script type="module" src="/assets/index.js"></script>
</head>
<body><div id="app"></div></body>
</html>
`

const plans = [
  { no: 1, slug: 'intro', title: 'Intro', description: 'First slide', params: {} },
  { no: 2, slug: 'chart', title: 'Branch harmony', description: 'Bubbles vs heatmap', params: normalizeSlideParams({ m: { values: ['bubbles', 'heatmap', 'pm'], default: 'bubbles' } }).params },
].map(p => ({
  ...p,
  appPath: `/${p.no}-${p.slug}`,
  imageAppPath: `/_og/${p.no}-${p.slug}.jpg`,
  contentHash: `hash${p.no}`,
  canonical: `${BASE_URL}/${p.no}-${p.slug}`,
  imageUrl: `${BASE_URL}/_og/${p.no}-${p.slug}.jpg`,
}))

const manifest: WorkerManifest = buildWorkerManifest(plans, {
  baseUrl: BASE_URL,
  appBase: '/',
  alwaysStamp: false,
  publicPaths: [],
  card: { size: [1200, 675], format: 'jpg', quality: 85 },
  hasBareSlug: () => true,
})

// Stand-ins for pre-rendered cards: distinct bytes per slide, including non-UTF-8 ones.
const card = (no: number) => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, no, ...Array.from({ length: 2048 }, (_, i) => (i * 31 + no) % 256)])

let root: string
// The build output, and the Worker next to it.
let dir: string
let workerDir: string

function serveAssets(request: Request): Response {
  const path = decodeURIComponent(new URL(request.url).pathname)
  const candidates = path.endsWith('/') ? [`${path}index.html`] : [path, `${path}.html`]
  const hit = candidates.map(c => join(dir, c)).find(f => existsSync(f) && !f.endsWith('/'))
  const file = hit ?? join(dir, 'index.html')
  const type = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.js': 'text/javascript' }[extname(file)] ?? 'application/octet-stream'
  return new Response(readFileSync(file), { headers: { 'Content-Type': type, 'ETag': '"asset"' } })
}

function miniflare(entry: string, bindings: Record<string, string> = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: join(workerDir, entry),
    modulesRoot: join(workerDir),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2026-07-01',
    bindings,
    serviceBindings: { ASSETS: serveAssets as any },
  })
}

function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', '#39': '\'' })[e]!)
}

/** `[key, content]` of every share tag, plus `title` and `canonical`, in document order (unescaped). */
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

function expectedTags(title: string, description: string, url: string, image: string): [string, string][] {
  return [
    ['title', title],
    ['og:title', title],
    ['description', description],
    ['og:type', 'website'],
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

async function bytesOf(res: { arrayBuffer: () => Promise<ArrayBuffer> }) {
  return new Uint8Array(await res.arrayBuffer())
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'slidev-og-worker-'))
  dir = join(root, 'dist')
  workerDir = join(root, 'dist-worker')
  mkdirSync(join(dir, '_og'), { recursive: true })
  writeFileSync(join(dir, 'index.html'), SPA_SHELL)
  for (const p of plans) {
    // What `generateOgShells` writes: per-slide shells with the default tags, and the cards.
    const shell = injectPerSlideMeta(SPA_SHELL, p)
    writeFileSync(join(dir, `${p.no}.html`), shell)
    writeFileSync(join(dir, `${p.no}-${p.slug}.html`), shell)
    writeFileSync(join(dir, `${p.slug}.html`), shell)
    writeFileSync(join(dir, '_og', `${p.no}-${p.slug}.jpg`), card(p.no))
  }
  await writeWorkerBundle(dir, manifest, { name: 'deck', renderer: 'none' })
  // A fake renderer, to exercise the on-demand path and its cache: the body counts renders.
  writeFileSync(join(workerDir, 'rendered.js'), `import { manifest } from './deck.js'
import { createWorker } from './runtime.js'
let renders = 0
export default createWorker(manifest, {
  renderer: async ({ query, url, card }) => new TextEncoder().encode(\`render \${++renders} \${query} \${url} \${card.size.join('x')}\`),
})
`)
  // An auth gate that blocks everything it's asked about.
  writeFileSync(join(workerDir, 'gated.js'), `import { manifest, renderer } from './deck.js'
import { createWorker } from './runtime.js'
export default createWorker(manifest, { renderer, gate: () => new Response('login', { status: 401 }) })
`)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('generated bundle', () => {
  it('writes the entry, deck manifest, runtime and wrangler template next to the build output', () => {
    expect(readFileSync(join(workerDir, 'index.js'), 'utf-8')).toBe(WORKER_ENTRY)
    expect(readFileSync(join(workerDir, 'deck.js'), 'utf-8')).toBe(renderWorkerDeck(manifest, 'none'))
    expect(existsSync(join(workerDir, 'runtime.js'))).toBe(true)
    const wrangler = readFileSync(join(workerDir, 'wrangler.jsonc'), 'utf-8')
    // JSONC: strip line comments before parsing.
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
    })
  })
})

describe('default entry (no renderer)', () => {
  let mf: Miniflare
  beforeAll(() => {
    mf = miniflare('index.js')
  })
  afterAll(() => mf.dispose())

  const get = (path: string, ua = SLACK_UA) => mf.dispatchFetch(`${BASE_URL}${path}`, { headers: { 'User-Agent': ua } })

  it('stamps an unfurler\'s parametrized slide URL with canonical params, whatever their order', async () => {
    const tags = expectedTags('Branch harmony', 'Bubbles vs heatmap', `${BASE_URL}/2-chart?m=heatmap`, `${BASE_URL}/_og/2-chart.jpg?m=heatmap&v=hash2`)
    for (const path of ['/2-chart?m=heatmap&x=1', '/2-chart?x=1&m=heatmap', '/2?m=heatmap', '/chart?m=heatmap']) {
      const res = await get(path)
      expect([res.status, res.headers.get('Cache-Control')]).toEqual([200, 'no-cache'])
      expect(shareTagsOf(await res.text())).toEqual(tags)
    }
  })

  it('stamps the default state with no params', async () => {
    const tags = expectedTags('Branch harmony', 'Bubbles vs heatmap', `${BASE_URL}/2-chart`, `${BASE_URL}/_og/2-chart.jpg?v=hash2`)
    for (const path of ['/2-chart', '/2-chart?m=bubbles', '/2-chart?m=bogus&utm_source=x']) {
      const res = await get(path)
      expect(shareTagsOf(await res.text())).toEqual(tags)
    }
  })

  it('keeps the SPA bootstrap in a stamped shell', async () => {
    const html = await (await get('/1')).text()
    expect(html.split('\n').filter(l => l.includes('<script'))).toEqual(['<script type="module" src="/assets/index.js"></script>'])
  })

  it('adds the tags a shell lacks', async () => {
    // `index.html` has only `og:title`; serve it for slide 1 by overwriting that slide's shell.
    const shellFile = join(dir, '1-intro.html')
    const original = readFileSync(shellFile)
    writeFileSync(shellFile, SPA_SHELL)
    try {
      const html = await (await get('/1-intro')).text()
      expect(shareTagsOf(html)).toEqual(expectedTags('Intro', 'First slide', `${BASE_URL}/1-intro`, `${BASE_URL}/_og/1-intro.jpg?v=hash1`))
    }
    finally {
      writeFileSync(shellFile, original)
    }
  })

  it('serves browsers the static files untouched', async () => {
    const res = await get('/2-chart?m=heatmap', BROWSER_UA)
    expect([res.headers.get('ETag'), await res.text()]).toEqual(['"asset"', readFileSync(join(dir, '2-chart.html'), 'utf-8')])
  })

  it('serves the pre-rendered card byte-for-byte when there are no non-default params', async () => {
    for (const path of ['/_og/2-chart.jpg', '/_og/2-chart.jpg?v=hash2', '/_og/2-chart.jpg?m=bubbles&v=hash2', '/_og/2.jpg?x=1']) {
      const res = await get(path)
      expect([res.status, res.headers.get('Content-Type')]).toEqual([200, 'image/jpeg'])
      expect(await bytesOf(res)).toEqual(card(2))
    }
  })

  it('falls back to the default card for a parametrized one, with a short cache', async () => {
    const res = await get('/_og/2-chart.jpg?m=heatmap&v=hash2')
    expect([res.status, res.headers.get('X-Slidev-Card'), res.headers.get('Cache-Control')]).toEqual([200, 'default', 'public, max-age=300'])
    expect(await bytesOf(res)).toEqual(card(2))
  })
})

describe('entry with a renderer', () => {
  let mf: Miniflare
  beforeAll(() => {
    mf = miniflare('rendered.js')
  })
  afterAll(() => mf.dispose())

  const get = (path: string) => mf.dispatchFetch(`${BASE_URL}${path}`)
  const renderedBody = (n: number) => `render ${n} m=heatmap ${BASE_URL}/2?m=heatmap&print=true&range=2 1200x675`

  it('renders a parametrized card once, then serves equivalent URLs from the cache', async () => {
    const first = await get('/_og/2-chart.jpg?m=heatmap&v=hash2')
    expect([first.headers.get('Content-Type'), first.headers.get('X-Slidev-Card'), await first.text()])
      .toEqual(['image/jpeg', 'rendered', renderedBody(1)])
    // `cache.put` runs in `waitUntil`, so it may land just after the first response.
    let again = ''
    for (let i = 0; i < 20 && again !== renderedBody(1); i++)
      again = await (await get('/_og/2.jpg?x=1&m=heatmap&v=stale')).text()
    expect(again).toBe(renderedBody(1))
  })

  it('never renders the default state', async () => {
    expect(await bytesOf(await get('/_og/2-chart.jpg?m=bubbles'))).toEqual(card(2))
  })
})

describe('entry with a gate', () => {
  let mf: Miniflare
  beforeAll(() => {
    mf = miniflare('gated.js', { SLIDEV_RENDER_TOKEN: 'secret' })
  })
  afterAll(() => mf.dispose())

  const get = (path: string, headers: Record<string, string>) => mf.dispatchFetch(`${BASE_URL}${path}`, { headers })

  it('gives blocked unfurlers a meta-only page, never the SPA', async () => {
    const res = await get('/2-chart?m=heatmap', { 'User-Agent': SLACK_UA })
    const html = await res.text()
    expect([res.status, html.includes('<script')]).toEqual([200, false])
    const url = `${BASE_URL}/2-chart?m=heatmap`
    const image = `${BASE_URL}/_og/2-chart.jpg?m=heatmap&v=hash2`
    expect(shareTagsOf(html)).toEqual([
      ['title', 'Branch harmony'],
      ['description', 'Bubbles vs heatmap'],
      ['og:type', 'website'],
      ['og:title', 'Branch harmony'],
      ['og:description', 'Bubbles vs heatmap'],
      ['og:image', image],
      ['og:url', url],
      ['twitter:card', 'summary_large_image'],
      ['twitter:title', 'Branch harmony'],
      ['twitter:description', 'Bubbles vs heatmap'],
      ['twitter:image', image],
      ['canonical', url],
    ])
  })

  it('returns the gate\'s response to everyone else', async () => {
    const res = await get('/2-chart', { 'User-Agent': BROWSER_UA })
    expect([res.status, await res.text()]).toEqual([401, 'login'])
  })

  it('leaves `/_og/*` public', async () => {
    const res = await get('/_og/2-chart.jpg', { 'User-Agent': BROWSER_UA })
    expect([res.status, await bytesOf(res)]).toEqual([200, card(2)])
  })

  it('lets the renderer through with the render token', async () => {
    const res = await get('/2?m=heatmap&print=true&range=2', { 'User-Agent': BROWSER_UA, 'X-Slidev-Render-Token': 'secret' })
    expect([res.status, await res.text()]).toEqual([200, readFileSync(join(dir, '2.html'), 'utf-8')])
  })
})
