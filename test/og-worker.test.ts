import type { PuppeteerLike, WorkerManifest, WorkerSlide } from '../packages/slidev/node/worker/runtime'
import { describe, expect, it } from 'vitest'
import { buildWorkerManifest, resolveWorkerConfig } from '../packages/slidev/node/commands/og'
import { browserRenderer, matchCard, matchSlide, renderUrl, shareInfoFor } from '../packages/slidev/node/worker/runtime'
import { canonicalizeParams, normalizeSlideParams } from '../packages/slidev/node/worker/shared'

const modeParams = normalizeSlideParams({
  m: { values: ['bubbles', 'heatmap', 'pm'], default: 'bubbles' },
  sort: ['name', 'size'],
}).params

describe('normalizeSlideParams', () => {
  it('accepts the object form and the list shorthand (first value is the default)', () => {
    expect(modeParams).toEqual({
      m: { values: ['bubbles', 'heatmap', 'pm'], default: 'bubbles' },
      sort: { values: ['name', 'size'], default: 'name' },
    })
  })

  it('stringifies YAML scalars and dedupes values', () => {
    expect(normalizeSlideParams({ n: { values: [1, 2, 2, true], default: 2 } })).toEqual({
      params: { n: { values: ['1', '2', 'true'], default: '2' } },
      warnings: [],
    })
  })

  it('skips bad declarations, with a warning each', () => {
    expect(normalizeSlideParams({
      'v': ['a'],
      'print': ['a'],
      'a b': ['a'],
      'empty': { values: [] },
      'none': { default: 'x' },
      'baddef': { values: ['a'], default: 'b' },
      'ok': ['x', 'y'],
    })).toEqual({
      params: { ok: { values: ['x', 'y'], default: 'x' } },
      warnings: [
        'param `v`: the name is reserved by slidev',
        'param `print`: the name is reserved by slidev',
        'param `a b`: names may only contain letters, digits, `_` and `-`',
        'param `empty`: needs a non-empty `values` list',
        'param `none`: needs a non-empty `values` list',
        'param `baddef`: default `b` isn\'t one of its `values`',
      ],
    })
  })

  it('treats a missing declaration as no params, and a non-map as an error', () => {
    expect(normalizeSlideParams(undefined)).toEqual({ params: {}, warnings: [] })
    expect(normalizeSlideParams(['m'])).toEqual({ params: {}, warnings: ['`params` must be a map of param name to declaration'] })
  })
})

describe('canonicalizeParams', () => {
  it('is independent of param order, and drops unknown params', () => {
    expect(canonicalizeParams(modeParams, 'm=heatmap&x=1')).toBe('m=heatmap')
    expect(canonicalizeParams(modeParams, 'x=1&m=heatmap')).toBe('m=heatmap')
  })

  it('sorts by name', () => {
    expect(canonicalizeParams(modeParams, 'sort=size&m=pm')).toBe('m=pm&sort=size')
  })

  it('drops defaults, so the default state has no params', () => {
    expect(canonicalizeParams(modeParams, 'm=bubbles&sort=name')).toBe('')
    expect(canonicalizeParams(modeParams, '')).toBe('')
    expect(canonicalizeParams(modeParams, 'm=bubbles&sort=size')).toBe('sort=size')
  })

  it('drops values the slide doesn\'t declare', () => {
    expect(canonicalizeParams(modeParams, 'm=evil&sort=size')).toBe('sort=size')
  })

  it('uses the first of repeated keys, and drops the card\'s `v`', () => {
    expect(canonicalizeParams(modeParams, 'm=pm&m=heatmap&v=abc')).toBe('m=pm')
  })

  it('is empty for slides without params', () => {
    expect(canonicalizeParams(undefined, 'm=heatmap')).toBe('')
    expect(canonicalizeParams({}, 'm=heatmap')).toBe('')
  })

  it('takes `URLSearchParams` too', () => {
    expect(canonicalizeParams(modeParams, new URL('https://x.test/2?x=1&m=heatmap').searchParams)).toBe('m=heatmap')
  })
})

const slides: WorkerSlide[] = [
  { no: 1, slug: 'intro', title: 'Intro', description: 'd1', path: '/1-intro', image: '/_og/1-intro.jpg', hash: 'h1', bareSlug: true },
  { no: 2, slug: 'chart', title: 'Chart', description: 'd2', path: '/2-chart', image: '/_og/2-chart.jpg', hash: 'h2', bareSlug: false, params: modeParams },
]
const manifest: WorkerManifest = {
  version: 1,
  baseUrl: 'https://deck.example',
  base: '/',
  alwaysStamp: false,
  publicPaths: ['/_og/*'],
  publicCards: true,
  card: { size: [1200, 675], format: 'jpg', quality: 85 },
  slides,
}

describe('matchSlide', () => {
  it('resolves `n`, `n-slug` and unique bare slugs', () => {
    expect(['1', '1-intro', 'intro', '1-intro/', '2', '2-chart'].map(r => matchSlide(slides, r)?.no))
      .toEqual([1, 1, 1, 1, 2, 2])
  })

  it('rejects wrong slugs, non-unique bare slugs, nested and unknown paths', () => {
    expect(['1-chart', 'chart', '3', '', 'assets/x.js', 'presenter/1'].map(r => matchSlide(slides, r)?.no))
      .toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })
})

describe('matchCard', () => {
  it('resolves `_og/<n>-<slug>.<ext>` and `_og/<n>.<ext>` in the deck\'s format', () => {
    expect(['_og/2-chart.jpg', '_og/2.jpg', '_og/2-chart.png', '_og/2-intro.jpg', '_og/9.jpg', '_og/2-chart.html'].map(r => matchCard(manifest, r)?.no))
      .toEqual([2, 2, undefined, undefined, undefined, undefined])
  })
})

describe('shareInfoFor', () => {
  it('puts the canonical params and the content hash on the card URL', () => {
    expect(shareInfoFor(manifest, slides[1], 'm=heatmap')).toEqual({
      title: 'Chart',
      description: 'd2',
      url: 'https://deck.example/2-chart?m=heatmap',
      image: 'https://deck.example/_og/2-chart.jpg?m=heatmap&v=h2',
    })
  })

  it('has only `v` in the default state', () => {
    expect(shareInfoFor(manifest, slides[1], '')).toEqual({
      title: 'Chart',
      description: 'd2',
      url: 'https://deck.example/2-chart',
      image: 'https://deck.example/_og/2-chart.jpg?v=h2',
    })
  })

  it('keeps a path prefix in `baseUrl` and the Vite base in app paths', () => {
    const m = { ...manifest, baseUrl: 'https://x.test/talks', base: '/deck/' }
    const s = { ...slides[0], path: '/deck/1-intro', image: '/deck/_og/1-intro.jpg' }
    expect(shareInfoFor(m, s, '')).toEqual({
      title: 'Intro',
      description: 'd1',
      url: 'https://x.test/talks/deck/1-intro',
      image: 'https://x.test/talks/deck/_og/1-intro.jpg?v=h1',
    })
  })
})

describe('renderUrl', () => {
  it('loads the slide in print mode with its params', () => {
    expect(renderUrl('https://deck.example', manifest, slides[1], 'm=heatmap'))
      .toBe('https://deck.example/2?m=heatmap&print=true&range=2')
    expect(renderUrl('https://deck.example', { ...manifest, base: '/deck' }, slides[1], 'm=pm'))
      .toBe('https://deck.example/deck/2?m=pm&print=true&range=2')
  })
})

describe('browserRenderer', () => {
  function mockPuppeteer(calls: string[]): PuppeteerLike {
    return {
      async launch(binding) {
        calls.push(`launch ${binding}`)
        return {
          async newPage() {
            return {
              async setViewport(v) { calls.push(`viewport ${v.width}x${v.height}`) },
              async setExtraHTTPHeaders(h) { calls.push(`headers ${JSON.stringify(h)}`) },
              async goto(url, o) { calls.push(`goto ${url} ${o.waitUntil}`) },
              async waitForSelector(sel) {
                calls.push(`wait ${sel}`)
                return { async screenshot(o) {
                  calls.push(`screenshot ${JSON.stringify(o)}`)
                  return new Uint8Array([1, 2, 3])
                } }
              },
              async waitForFunction() { calls.push('wait loaded') },
            }
          },
          async close() { calls.push('close') },
        }
      },
    }
  }
  const req = { slide: slides[1], query: 'm=heatmap', url: 'https://deck.example/2?m=heatmap&print=true&range=2', card: manifest.card }

  it('screenshots the slide at the card size', async () => {
    const calls: string[] = []
    const bytes = await browserRenderer(mockPuppeteer(calls))({ ...req, env: { ASSETS: null!, BROWSER: 'binding', SLIDEV_RENDER_TOKEN: 'tok' } })
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(calls).toEqual([
      'launch binding',
      'viewport 1200x675',
      'headers {"X-Slidev-Render-Token":"tok"}',
      'goto https://deck.example/2?m=heatmap&print=true&range=2 load',
      'wait [data-slidev-no="2"]',
      'wait loaded',
      'screenshot {"type":"jpeg","quality":85}',
      'close',
    ])
  })

  it('returns `null` without the binding', async () => {
    const calls: string[] = []
    expect(await browserRenderer(mockPuppeteer(calls))({ ...req, env: { ASSETS: null! } })).toBe(null)
    expect(calls).toEqual([])
  })
})

describe('resolveWorkerConfig', () => {
  it('is on with `--worker` or `publish.worker`, and `--no-worker` wins', () => {
    expect([
      resolveWorkerConfig(undefined, undefined),
      resolveWorkerConfig(false, undefined),
      resolveWorkerConfig(undefined, true),
      resolveWorkerConfig(true, undefined),
      resolveWorkerConfig({ name: 'talk', renderer: 'none' }, undefined),
      resolveWorkerConfig({ renderer: 'bogus' }, undefined),
      resolveWorkerConfig(true, false),
    ]).toEqual([
      null,
      null,
      { name: undefined, renderer: undefined, publicOg: true },
      { name: undefined, renderer: undefined, publicOg: true },
      { name: 'talk', renderer: 'none', publicOg: true },
      { name: undefined, renderer: undefined, publicOg: true },
      null,
    ])
  })

  it('reads `auth` and its options, from the headmatter or `--auth` (which implies `--worker`)', () => {
    const auth = { provider: 'open-athena', staffDomains: [], admins: [], scope: 'deck', database: undefined, databaseId: undefined }
    expect([
      resolveWorkerConfig(undefined, undefined, 'open-athena'),
      resolveWorkerConfig(true, undefined, 'open-athena'),
      resolveWorkerConfig({ auth: 'open-athena' }, undefined),
      resolveWorkerConfig({
        auth: 'open-athena',
        staffDomain: 'openathena.ai',
        admins: ['a@x.test', ' b@x.test '],
        publicOg: false,
        scope: 'talk',
        database: 'talk-db',
        databaseId: 'abc',
      }, undefined),
      resolveWorkerConfig({ auth: 'open-athena', staffDomain: ['a.test', 'b.test'] }, undefined),
      resolveWorkerConfig(undefined, false, 'open-athena'),
    ]).toEqual([
      { name: undefined, renderer: undefined, publicOg: true, auth },
      { name: undefined, renderer: undefined, publicOg: true, auth },
      { name: undefined, renderer: undefined, publicOg: true, auth },
      {
        name: undefined,
        renderer: undefined,
        publicOg: false,
        auth: { provider: 'open-athena', staffDomains: ['openathena.ai'], admins: ['a@x.test', 'b@x.test'], scope: 'talk', database: 'talk-db', databaseId: 'abc' },
      },
      { name: undefined, renderer: undefined, publicOg: true, auth: { ...auth, staffDomains: ['a.test', 'b.test'] } },
      null,
    ])
  })

  it('refuses an unknown auth provider rather than build an ungated deck', () => {
    expect(() => resolveWorkerConfig({ auth: 'okta' }, undefined)).toThrow('[Slidev] Worker: unknown `auth` provider "okta"; supported: open-athena')
    expect(() => resolveWorkerConfig(true, undefined, 'okta')).toThrow('[Slidev] Worker: unknown `auth` provider "okta"; supported: open-athena')
  })
})

describe('buildWorkerManifest', () => {
  it('maps plans to Worker slides, and always makes `/_og/*` public', () => {
    const plans = [
      { no: 1, slug: 'intro', title: 'Intro', description: 'd1', appPath: '/1-intro', imageAppPath: '/_og/1-intro.jpg', contentHash: 'h1', params: {} },
      { no: 2, slug: 'chart', title: 'Chart', description: 'd2', appPath: '/2-chart', imageAppPath: '/_og/2-chart.jpg', contentHash: 'h2', params: modeParams },
    ]
    expect(buildWorkerManifest(plans, {
      baseUrl: 'https://deck.example/',
      appBase: '/',
      alwaysStamp: false,
      publicPaths: ['/about', '/_og/*'],
      card: manifest.card,
      hasBareSlug: p => p.slug === 'intro',
    })).toEqual({ ...manifest, publicPaths: ['/_og/*', '/about'] })
  })

  it('leaves `/_og/*` out of the public paths without `publicCards`', () => {
    expect(buildWorkerManifest([], {
      baseUrl: 'https://deck.example',
      appBase: '/',
      alwaysStamp: false,
      publicPaths: ['/about'],
      publicCards: false,
      card: manifest.card,
      hasBareSlug: () => false,
    })).toEqual({ ...manifest, publicPaths: ['/about'], publicCards: false, slides: [] })
  })
})
