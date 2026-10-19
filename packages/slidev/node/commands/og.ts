import type { BuildArgs, ResolvedSlidevOptions, SlideInfo } from '@slidev/types'
import type { ResolvedConfig } from 'vite'
import type { WorkerManifest } from '../worker/runtime'
import type { SlideParams } from '../worker/shared'
import type { OgManifest } from './publish'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import connect from 'connect'
import sirv from 'sirv'
import { htmlEscape, normalizeSlideParams, shareTags } from '../worker/shared'

export { htmlEscape }

// 1200×675 = exact 16:9 — matches the slide canvas, so the OG export has no
// pillarbox margins in a different bg color than the slide. Platforms that
// strictly want 1.91:1 (FB/LinkedIn) center-crop ~22 px equivalent; the slide
// title row still lands in the visible OG card.
const DEFAULT_OG_SIZE: [number, number] = [1200, 675]
const DEFAULT_OG_FORMAT: 'png' | 'jpg' = 'jpg'
const DEFAULT_OG_QUALITY = 85

interface SlideOgInfo {
  no: number
  slug: string
  title: string
  description: string
  /** Absolute URL to the canonical interactive slide route. */
  canonical: string
  /** Public URL of the OG image (absolute). */
  imageUrl: string
  /** Relative path under the deck userRoot if user supplied an explicit override; else null. */
  overrideSrc: string | null
  /** Filename (no dir) the OG image should be written / copied to under `dist/_og/`. */
  imageFilename: string
  /** Filename (no dir) for the HTML shell. */
  htmlFilename: string
  /** Content hash (slide source + render-relevant settings); used as the cache key. */
  contentHash: string
  /** Frontmatter `caption`: the slide's post text in published threads. */
  caption?: string
  /** Frontmatter `skipThread`: leave the slide out of published threads. */
  skipThread?: boolean
  /** App path (including the Vite `base`) of the canonical slide route. */
  appPath: string
  /** App path of the OG image. */
  imageAppPath: string
  /** URL params the slide declares in frontmatter (`params`), for the Worker deploy target. */
  params: SlideParams
}

const SLUG_PUNCT_RE = /[^\w\s-]+/g
const SLUG_SPACE_RE = /[\s_-]+/g
const SLUG_TRIM_RE = /^-+|-+$/g

export function slugify(s: string): string {
  return (s ?? '')
    .normalize('NFKD')
    // Strip Unicode combining marks via the Unicode property class (works post-NFKD
    // decomposition: "é" → "e + ́" → "e").
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(SLUG_PUNCT_RE, ' ')
    .replace(SLUG_SPACE_RE, '-')
    .replace(SLUG_TRIM_RE, '')
    .slice(0, 80) || ''
}

export function pickSlug(slide: SlideInfo, no: number): string {
  const fm = slide.frontmatter ?? {}
  return (
    (typeof fm.slug === 'string' && slugify(fm.slug))
    || (typeof fm.routeAlias === 'string' && slugify(fm.routeAlias))
    || (typeof fm.title === 'string' && slugify(fm.title))
    || (typeof slide.title === 'string' && slugify(slide.title))
    || `slide-${no}`
  )
}

// Strip frontmatter, fenced blocks, components, and basic markdown markers to recover the first
// paragraph of human-readable text. Heuristic — good enough for OG description fallback.
export function firstParagraph(content: string): string {
  if (!content)
    return ''
  let text = content
  // Strip fenced code blocks (``` ... ```)
  text = text.replace(/```[\s\S]*?```/g, '')
  // Strip `<style>` and `<script>` blocks WITH their contents — `<[^>]+>` below
  // only removes opening/closing tags, which would leave CSS / JS body text
  // leaking into the description.
  text = text.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  // Strip Vue/HTML components and tags entirely (incl. self-closing)
  text = text.replace(/<[^>]+>/g, '')
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let started = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (started)
        break
      continue
    }
    // Skip headings, list bullets, blockquotes, hr, image-only lines, link-defs
    if (/^(?:#{1,6}\s|[-*+]\s|>\s|---$|!\[|\[[^\]]+\]:)/.test(line))
      continue
    started = true
    out.push(line)
  }
  return out.join(' ')
    .replace(/\*\*?(.+?)\*\*?/g, '$1') // bold/italic
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

// Strip markdown link syntax from a heading title — slidev passes the raw
// heading source as `slide.title`, so `# Demo: [foo.bar](https://foo.bar)`
// arrives as `Demo: [foo.bar](https://foo.bar)`. Keep the anchor text, drop
// the URL. Also collapse leftover `**bold**` / `*italic*` / `` `code` ``
// markers so the title reads naturally in social cards.
export function stripMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function pickTitle(slide: SlideInfo, deckTitle: string, no: number): string {
  const fm = slide.frontmatter ?? {}
  if (typeof fm.title === 'string' && fm.title.trim())
    return stripMd(fm.title)
  if (typeof slide.title === 'string' && slide.title.trim())
    return stripMd(slide.title)
  return `${deckTitle} — Slide ${no}`
}

function pickDescription(slide: SlideInfo): string {
  const fm = slide.frontmatter ?? {}
  if (typeof fm.description === 'string' && fm.description.trim())
    return fm.description.trim()
  return firstParagraph(slide.content)
}

// Join two URL-ish parts so there's exactly one slash between them (and trailing slashes on
// the base don't cause `//` doubling).
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

type CanonicalForm = 'n' | 'n-slug' | 'slug'

export function canonicalPathFor(no: number, slug: string, form: CanonicalForm): string {
  // `slug` form gracefully degrades to `n` when no slug is derivable, so the
  // result always resolves to a real slide. `n-slug` (default) likewise drops
  // back to `n` when there's no slug. Pure `n` ignores the slug entirely.
  switch (form) {
    case 'n': return String(no)
    case 'slug': return slug || String(no)
    case 'n-slug':
    default: return slug ? `${no}-${slug}` : String(no)
  }
}

function planSlide(
  slide: SlideInfo,
  no: number,
  deckTitle: string,
  baseUrl: string,
  appBase: string,
  ext: 'png' | 'jpg',
  renderKey: string,
  canonicalForm: CanonicalForm,
): SlideOgInfo {
  const slug = pickSlug(slide, no)
  const title = pickTitle(slide, deckTitle, no)
  const description = pickDescription(slide)
  const imageFilename = `${no}-${slug}.${ext}`
  const htmlFilename = `${no}-${slug}.html`
  const fm = slide.frontmatter ?? {}
  const overrideSrc = typeof fm.ogImage === 'string' ? fm.ogImage : null
  // Canonical URL form is `publish.canonicalForm` (default `'n-slug'`) — see
  // `canonicalPathFor`. All three URL forms keep resolving regardless of this
  // setting (each emits its own pre-rendered shell + the slug-route redirect
  // handles bare slugs); this only changes which one is stamped into
  // `<link rel=canonical>` / `og:url`.
  const appPath = joinUrl(appBase || '/', canonicalPathFor(no, slug, canonicalForm))
  const canonical = joinUrl(baseUrl, appPath)
  const imageAppPath = joinUrl(appBase || '/', `_og/${imageFilename}`)
  const imageUrl = joinUrl(baseUrl, imageAppPath)
  // Cache key includes the slide source + render-relevant config (size/format) — captured by
  // `renderKey` — so editing a slide invalidates *that* slide and resizing the image
  // invalidates *all* of them.
  const slideHash = createHash('sha1')
    .update(slide.source?.raw ?? slide.content ?? '')
    .update('\u0000')
    .update(JSON.stringify(fm))
    .update('\u0000')
    .update(renderKey)
    .digest('hex')
    .slice(0, 12)
  const { params, warnings } = normalizeSlideParams(fm.params)
  for (const w of warnings)
    console.warn(`[Slidev] OG: slide ${no} ${w}; ignoring it`)
  const info: SlideOgInfo = { no, slug, title, description, canonical, imageUrl, overrideSrc, imageFilename, htmlFilename, contentHash: slideHash, appPath, imageAppPath, params }
  if (typeof fm.caption === 'string' && fm.caption.trim())
    info.caption = fm.caption.trim()
  if (fm.skipThread)
    info.skipThread = true
  return info
}

/**
 * The `_og/slides.json` manifest: what `slidev publish` needs from a build (each slide's
 * canonical URL, card text and image), so publishing reads `dist/` alone and links exactly the
 * URLs and images that were built.
 */
export function ogManifest(plans: SlideOgInfo[], deck: OgManifest['deck']): OgManifest {
  return {
    version: 1,
    deck,
    slides: plans.map(p => ({
      no: p.no,
      slug: p.slug,
      title: p.title,
      description: p.description,
      ...(p.caption ? { caption: p.caption } : {}),
      canonical: p.canonical,
      image: p.imageFilename,
      ...(p.skipThread ? { skipThread: true } : {}),
    })),
  }
}

function renderShell(info: SlideOgInfo): string {
  const t = htmlEscape(info.title)
  const d = htmlEscape(info.description)
  const u = htmlEscape(info.canonical)
  const img = htmlEscape(info.imageUrl)
  // The shell exists for OG scrapers; humans get bounced into the SPA via meta-refresh +
  // an immediate JS replace. We avoid an HTTP redirect so the OG `<meta>` tags actually
  // reach scrapers (most don't follow 30x).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${u}">
<meta property="og:type" content="article">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${u}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${u}">
<style>html,body{margin:0;padding:0;background:#0e0e10;color:#eee;font:14px/1.4 system-ui,sans-serif}main{padding:2rem}a{color:#69f}</style>
</head>
<body>
<main>
<p>Redirecting to <a href="${u}">${u}</a>&hellip;</p>
<script>location.replace(${JSON.stringify(info.canonical)})</script>
</main>
</body>
</html>
`
}

function renderIndex(
  plans: SlideOgInfo[],
  deckTitle: string,
  deckUrl: string,
  size: [number, number],
): string {
  const title = htmlEscape(`${deckTitle} — OG previews`)
  // Two affordances per card: clickable thumbnail (opens a popover lightbox of the
  // full-resolution image), plus two small action links — "slide" (canonical
  // route) and "image" (re-opens the lightbox, mirrors the thumb click). The
  // `popovertarget` HTML attribute drives the lightbox open/close with no JS
  // (baseline since 2024; ESC + click-on-backdrop close it).
  const cards = plans.map((p) => {
    const slug = htmlEscape(p.slug)
    const slideTitle = htmlEscape(p.title)
    const canonical = htmlEscape(p.canonical)
    const img = htmlEscape(p.imageFilename)
    const lbId = `lb-${p.no}`
    return `<div class="card">
  <button class="thumb" popovertarget="${lbId}" aria-label="Preview slide ${p.no} image">
    <img loading="lazy" src="./${img}" width="${size[0]}" height="${size[1]}" alt="${slideTitle}">
  </button>
  <div class="meta">
    <div class="n">${p.no}.</div>
    <div class="t">${slideTitle}</div>
    <div class="s">${slug}</div>
    <div class="actions">
      <a class="act" href="${canonical}" title="Open slide ${p.no} in deck">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6 3h7v7M13 3l-8 8M3 7v6h6"/></svg>
        slide
      </a>
      <button class="act" popovertarget="${lbId}" title="Preview image at full size">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>
        image
      </button>
    </div>
  </div>
</div>`
  }).join('\n')
  // Wrap the image in a `popovertargetaction="hide"` button so clicking the
  // image itself closes the lightbox (in addition to ESC + click-on-backdrop,
  // which `popover="auto"` handles natively).
  const lightboxes = plans.map((p) => {
    const img = htmlEscape(p.imageFilename)
    const slideTitle = htmlEscape(p.title)
    return `<div id="lb-${p.no}" class="lb" popover>
  <button class="lb-close" popovertarget="lb-${p.no}" popovertargetaction="hide" aria-label="Close preview">
    <img src="./${img}" alt="${slideTitle}">
  </button>
</div>`
  }).join('\n')
  // Same dark `system-ui` style as the existing OG redirect shell. Self-contained: no
  // external fonts or JS. Renders fine without JS for crawlers / curl — the lightbox
  // is the only interactive piece and it degrades to "image link doesn't open" (the
  // direct image still loads at `./<filename>.jpg`).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${htmlEscape(`Per-slide OG share-card previews for ${deckTitle}.`)}">
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #0e0e10; color: #eee; font: 14px/1.4 system-ui, sans-serif; }
  header { padding: 1.5rem 2rem 0.5rem; }
  header h1 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 600; }
  header .sub { opacity: 0.6; font-size: 0.8rem; }
  header .sub a { color: #69f; text-decoration: none; }
  header .sub a:hover { text-decoration: underline; }
  main { padding: 1rem 2rem 3rem; display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card { display: flex; flex-direction: column; background: #18181b; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2e; transition: border-color 0.15s, transform 0.15s; }
  .card:hover { border-color: #69f; transform: translateY(-1px); }
  .thumb { display: block; width: 100%; padding: 0; margin: 0; background: none; border: none; cursor: zoom-in; color: inherit; }
  .thumb img { display: block; width: 100%; height: auto; aspect-ratio: ${size[0]} / ${size[1]}; background: #0e0e10; object-fit: cover; }
  .meta { padding: 0.6rem 0.8rem 0.75rem; display: grid; grid-template-columns: auto 1fr; column-gap: 0.5rem; row-gap: 0.15rem; align-items: baseline; }
  .meta .n { font-variant-numeric: tabular-nums; opacity: 0.5; }
  .meta .t { font-weight: 600; font-size: 0.95rem; }
  .meta .s { grid-column: 2; opacity: 0.45; font-size: 0.75rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .actions { grid-column: 1 / -1; margin-top: 0.4rem; display: flex; gap: 0.4rem; }
  .act { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.5rem; background: #222226; color: #ccc; text-decoration: none; border: 1px solid #2a2a2e; border-radius: 4px; font-size: 0.78rem; cursor: pointer; font-family: inherit; }
  .act:hover { border-color: #69f; color: #fff; }
  .lb { border: none; background: transparent; padding: 0; margin: auto; width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; overflow: hidden; }
  .lb::backdrop { background: rgba(0, 0, 0, 0.85); }
  .lb-close { display: block; width: 100%; height: 100%; padding: 0; margin: 0; background: none; border: none; cursor: zoom-out; }
  .lb img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <div class="sub">
    ${plans.length} slide${plans.length === 1 ? '' : 's'} · ${size[0]}×${size[1]} ·
    <a href="${htmlEscape(deckUrl)}">open deck</a>
  </div>
</header>
<main>
${cards}
</main>
${lightboxes}
</body>
</html>
`
}

export async function generateOgShells(
  options: ResolvedSlidevOptions,
  args: BuildArgs,
  outDir: string,
  config: ResolvedConfig,
): Promise<void> {
  const cfg = options.data.config as any
  const baseUrl: string | undefined = cfg.publish?.baseUrl
  if (!baseUrl) {
    // OG shells need absolute URLs; without `publish.baseUrl` we'd emit broken meta tags.
    // Skip silently for unconfigured decks rather than fail the build.
    if (resolveWorkerConfig(cfg.publish?.worker, args.worker))
      console.warn('[Slidev] Worker: needs `publish.baseUrl` in the headmatter; not writing it')
    return
  }
  const ogCfg = cfg.publish?.ogImage ?? {}
  const size: [number, number] = Array.isArray(ogCfg.size) && ogCfg.size.length === 2 ? ogCfg.size : DEFAULT_OG_SIZE
  let format: 'png' | 'jpg' = ogCfg.format === 'png' ? 'png' : DEFAULT_OG_FORMAT
  // JPEG cards need `sharp` (an optional dependency). Without it, write the whole run as PNG,
  // with `.png` names and URLs, rather than PNG bytes under a `.jpg` name.
  if (format === 'jpg' && !(await loadSharp())) {
    console.warn('[Slidev] OG: `sharp` isn\'t installed, so share cards are written as PNG')
    format = 'png'
  }
  const quality: number = typeof ogCfg.quality === 'number' ? ogCfg.quality : DEFAULT_OG_QUALITY

  const deckTitle: string = cfg.title ?? 'Slidev'
  const appBase: string = config.base ?? '/'
  const canonicalForm: CanonicalForm
    = cfg.publish?.canonicalForm === 'n' || cfg.publish?.canonicalForm === 'slug'
      ? cfg.publish.canonicalForm
      : 'n-slug'

  const ogDir = resolve(outDir, '_og')
  await fs.mkdir(ogDir, { recursive: true })

  // Persistent cache outside of `dist/` (which gets wiped each build). Keyed by content
  // hash so editing a slide invalidates only that slide. Safe to delete to force a full
  // re-render; safe to gitignore (and is, by global excludes since it's under .slidev/).
  const cacheDir = resolve(options.userRoot, '.slidev/og-cache')
  await fs.mkdir(cacheDir, { recursive: true })
  const cachePath = (p: SlideOgInfo) => resolve(cacheDir, `${p.no}-${p.contentHash}.${format}`)

  // Extra delay (ms) after the page `load` event before screenshotting. The
  // primary mechanism for waiting on async-loading content is `data-waitfor`
  // (see `exportSlides` + the Tweet / BlueSky components), so default is 0.
  // Escape hatch via headmatter `publish.ogImage.wait` for decks with custom
  // embeds that can't (or don't) emit a `data-waitfor` signal.
  const wait: number = typeof ogCfg.wait === 'number' ? ogCfg.wait : 0

  // Render-key: changes to size/format/wait invalidate the entire cache. `sharp` marks JPEGs
  // encoded by sharp, so `.jpg` cache entries written as PNG bytes (before the PNG fallback
  // switched the format) get re-rendered.
  const renderKey = `${size[0]}x${size[1]}.${format}${format === 'jpg' ? '.sharp' : ''}.w${wait}`

  // Plan each slide first (cheap) so the rest of the function can iterate over a uniform list.
  const plans: SlideOgInfo[] = []
  for (let i = 0; i < options.data.slides.length; i++) {
    const slide = options.data.slides[i]
    const fm = slide.frontmatter ?? {}
    if (fm.skipOg || fm.hide || fm.disabled)
      continue
    plans.push(planSlide(slide, i + 1, deckTitle, baseUrl, appBase, format, renderKey, canonicalForm))
  }
  // Slides without a description of their own (frontmatter, or a first paragraph) use the deck's.
  // `info` defaults to `false`, which must not become the text "false".
  const rawDeckDescription = [cfg.seoMeta?.ogDescription, cfg.info].find(v => typeof v === 'string' && v.trim())
  const deckDescription = stripMd(rawDeckDescription ?? '').trim()
  for (const p of plans)
    p.description ||= deckDescription

  // Decide which slides need image generation. Three buckets:
  //   - explicit override (`frontmatter.ogImage: ./foo.png`) → just copy from userRoot
  //   - cached (image present at `cachePath` with a matching hash) → copy cache → dist
  //   - rest → render via Playwright, write to cache and dist
  const overrides: SlideOgInfo[] = []
  const cached: SlideOgInfo[] = []
  const toRender: SlideOgInfo[] = []
  for (const p of plans) {
    if (p.overrideSrc) {
      overrides.push(p)
      continue
    }
    if (existsSync(cachePath(p))) {
      cached.push(p)
      continue
    }
    toRender.push(p)
  }

  for (const p of overrides) {
    const src = resolve(options.userRoot, p.overrideSrc!)
    if (!existsSync(src))
      throw new Error(`[Slidev] ogImage override for slide ${p.no} not found: ${p.overrideSrc}`)
    await fs.copyFile(src, resolve(ogDir, p.imageFilename))
  }

  for (const p of cached) {
    await fs.copyFile(cachePath(p), resolve(ogDir, p.imageFilename))
  }

  if (toRender.length > 0) {
    // Reuse the existing build-time PNG export path: spin up a sirv server against the
    // already-built `dist/`, drive Playwright via `exportSlides`, then pull the resulting
    // numbered files out of the temp dir and rename them into our slug-aware names.
    const port = 12446
    const app = connect()
    const server = http.createServer(app)
    app.use(
      appBase,
      sirv(outDir, { etag: true, single: true, dev: true }),
    )
    server.listen(port)
    try {
      const { exportSlides } = await import('./export')
      const tempDir = resolve(ogDir, '.tmp')
      await fs.mkdir(tempDir, { recursive: true })
      const range = toRender.map(p => p.no).join(',')
      await exportSlides({
        port,
        base: appBase,
        slides: options.data.slides,
        total: options.data.slides.length,
        format: format === 'jpg' ? 'png' : format, // Playwright export only emits PNG; we transcode below if needed
        output: tempDir,
        range,
        width: size[0],
        height: size[1],
        routerMode: cfg.routerMode,
        // `'load'` (vs `'networkidle'`) so a single flaky slide — Twitter widget, analytics
        // pixel, late web font — doesn't fail the entire build. Per-slide screenshots aren't
        // worth a hard build break; a slightly-not-fully-painted preview is still useful.
        waitUntil: 'load',
        wait,
        timeout: args.timeout || 15000,
        perSlide: true,
        omitBackground: false,
        dark: args.dark,
      })

      // Move each generated PNG into its slug-aware destination. exportSlides emits
      // 0-padded names like `01.png`, `02.png`, … for `perSlide: true`.
      const tempFiles = await fs.readdir(tempDir)
      const byNo = new Map<number, string>()
      for (const f of tempFiles) {
        const m = f.match(/^(\d+)(?:-\d+)?\.png$/)
        if (m)
          byNo.set(Number.parseInt(m[1], 10), f)
      }
      for (const p of toRender) {
        const tempName = byNo.get(p.no)
        if (!tempName) {
          console.warn(`[Slidev] OG: no rendered image found for slide ${p.no}`)
          continue
        }
        const src = resolve(tempDir, tempName)
        const dst = resolve(ogDir, p.imageFilename)
        const cache = cachePath(p)
        if (format === 'jpg') {
          // We requested PNG from exportSlides above; transcode to JPG (`sharp` is present, or
          // `format` would have fallen back to PNG).
          await transcodeToJpg(src, cache, quality)
        }
        else {
          await fs.copyFile(src, cache)
        }
        await fs.copyFile(cache, dst)
      }
      await fs.rm(tempDir, { recursive: true, force: true })
    }
    finally {
      server.close()
    }
  }

  // HTML shells are cheap to regenerate; always re-emit (so changes to title /
  // description / baseUrl take effect without invalidating the image cache).
  for (const p of plans) {
    await fs.writeFile(resolve(ogDir, p.htmlFilename), renderShell(p), 'utf-8')
  }

  // Gallery index at `_og/index.html` — lists every slide thumbnail and links
  // to the canonical slide URL. See specs/og-index-and-404.md.
  const deckUrl = joinUrl(baseUrl, appBase || '/')
  await fs.writeFile(resolve(ogDir, 'index.html'), renderIndex(plans, deckTitle, deckUrl, size), 'utf-8')
  const bskyHandle: unknown = cfg.publish?.bluesky?.handle
  const manifest = ogManifest(plans, {
    title: deckTitle,
    url: deckUrl,
    ...(typeof bskyHandle === 'string' && bskyHandle ? { bluesky: { handle: bskyHandle } } : {}),
  })
  await fs.writeFile(resolve(ogDir, 'slides.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')

  // Per-slide SPA shells so canonical URLs serve per-slide og:*/twitter:* meta to
  // scrapers without giving up the SPA. Three filenames per slide (all identical
  // content; only the *filename* differs — the og:url / canonical pinned in the
  // meta is always `/<n>-<slug>`):
  //   - `dist/<n>.html`           — number-only legacy / stable-ordering URL
  //   - `dist/<n>-<slug>.html`    — canonical
  //   - `dist/<slug>.html`        — bare-slug alias (renumber-resistant; skipped on collision)
  // GH Pages serves these for `/<n>`, `/<n>-<slug>`, `/<slug>` respectively (the
  // pretty-URL routing GH Pages does for `*.html` files). Browsers see the SPA
  // bootstrap exactly as they would from `index.html` / `404.html`.
  const shellPath = resolve(outDir, 'index.html')
  // Find slugs that would collide with each other, or with files we already emit
  // (`index`, `404`). Those slides skip the bare-slug alias; their canonical
  // `/<n>-<slug>` still works.
  const slugCounts = new Map<string, number>()
  for (const p of plans) {
    if (p.slug)
      slugCounts.set(p.slug, (slugCounts.get(p.slug) ?? 0) + 1)
  }
  const reservedSlugs = new Set(['index', '404'])
  const hasBareSlug = (p: Pick<SlideOgInfo, 'slug'>) => !!p.slug && !reservedSlugs.has(p.slug) && slugCounts.get(p.slug) === 1
  let bareSlugCount = 0
  if (existsSync(shellPath)) {
    const baseShell = await fs.readFile(shellPath, 'utf-8')

    for (const p of plans) {
      const rendered = injectPerSlideMeta(baseShell, p)
      // Always emit number-only shell (legacy + stable-ordering URL).
      await fs.writeFile(resolve(outDir, `${p.no}.html`), rendered, 'utf-8')
      // Emit canonical `<n>-<slug>.html` when slug present.
      if (p.slug)
        await fs.writeFile(resolve(outDir, `${p.no}-${p.slug}.html`), rendered, 'utf-8')
      // Emit bare `<slug>.html` only when slug is unique + not reserved.
      if (hasBareSlug(p)) {
        await fs.writeFile(resolve(outDir, `${p.slug}.html`), rendered, 'utf-8')
        bareSlugCount++
      }
    }
  }

  const workerCfg = resolveWorkerConfig(cfg.publish?.worker, args.worker)
  if (workerCfg) {
    if (cfg.routerMode === 'hash')
      console.warn('[Slidev] Worker: with `routerMode: hash`, slide URLs never reach the Worker, so only the `_og/*` cards are served per request')
    const manifest = buildWorkerManifest(plans, {
      baseUrl,
      appBase,
      alwaysStamp: !!cfg.publish?.ogAlwaysStamp,
      publicPaths: Array.isArray(cfg.publish?.publicPaths) ? cfg.publish.publicPaths.map(String) : [],
      card: { size, format, quality },
      hasBareSlug,
    })
    const workerDir = workerDirFor(outDir)
    // Resolved the way wrangler's bundler will, from the Worker's directory.
    const hasPuppeteer = findPackage(workerDir, '@cloudflare/puppeteer')
    const renderer = workerCfg.renderer ?? (hasPuppeteer ? 'browser' : 'none')
    if (renderer === 'browser' && !hasPuppeteer)
      console.warn('[Slidev] Worker: `renderer: browser` needs `@cloudflare/puppeteer` installed in the deck, to bundle the Worker')
    await writeWorkerBundle(outDir, manifest, { name: workerCfg.name ?? (slugify(deckTitle) || 'slidev-deck'), renderer })
    // eslint-disable-next-line no-console
    console.log(`[Slidev] Worker: wrote ${workerDir} (renderer: ${renderer}); run it with \`wrangler dev -c ${relative(process.cwd(), workerDir)}/wrangler.jsonc\` (or \`deploy\`)`)
  }

  // eslint-disable-next-line no-console
  console.log(`[Slidev] OG: wrote ${plans.length} shell(s) + gallery index + per-slide SPA shells (${plans.length} numbered, ${plans.filter(p => p.slug).length} slugged, ${bareSlugCount} bare-slug), rendered ${toRender.length} new image(s) (${cached.length} from cache) to ${ogDir}`)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Set a `<meta {attr}="{key}" content="...">` value: rewritten in place when the tag exists
// (under either `name` or `property`, attribute order either way, since the deck-level shell
// writes `property="twitter:..."`), else added before `</head>`.
export function setMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const v = htmlEscape(value)
  const k = escapeRegex(key)
  for (const a of [attr, attr === 'name' ? 'property' : 'name']) {
    // attr-first: <meta name="x" content="y">
    const re1 = new RegExp(`(<meta\\s+${a}="${k}"\\s+content=")[^"]*(")`)
    if (re1.test(html))
      return html.replace(re1, (_, open: string, close: string) => open + v + close)
    // content-first: <meta content="y" name="x">
    const re2 = new RegExp(`(<meta\\s+content=")[^"]*("\\s+${a}="${k}")`)
    if (re2.test(html))
      return html.replace(re2, (_, open: string, close: string) => open + v + close)
  }
  return html.replace(/<\/head>/, () => `<meta ${attr}="${key}" content="${v}">\n</head>`)
}

// Build a per-slide variant of the SPA shell, mutating only the head meta —
// title, description, og:*, twitter:* — so canonical `/<n>` URLs serve correct
// per-slide share cards to scrapers (browsers boot the SPA from this shell
// exactly as from `index.html`/`404.html`). Idempotent: if the deck-level shell
// already has a meta we'd inject, we replace its value; otherwise we append.
export function injectPerSlideMeta(shell: string, info: Pick<SlideOgInfo, 'title' | 'description' | 'canonical' | 'imageUrl'>): string {
  let html = shell
  const u = info.canonical

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${htmlEscape(info.title)}</title>`)
  // The same tags the Worker deploy target stamps per request (`worker/runtime.ts`).
  for (const tag of shareTags({ title: info.title, description: info.description, url: u, image: info.imageUrl })) {
    if (tag.ifPresent && !new RegExp(`(?:name|property)="${escapeRegex(tag.key)}"`).test(html))
      continue
    html = setMeta(html, tag.attr, tag.key, tag.value)
  }

  // Canonical link: replace if present, else inject before </head>.
  if (/<link\s+rel="canonical"/.test(html)) {
    html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${htmlEscape(u)}$2`)
  }
  else {
    html = html.replace(/<\/head>/, `<link rel="canonical" href="${htmlEscape(u)}">\n</head>`)
  }

  return html
}

let sharpModule: Promise<any> | undefined

/** `sharp`, or `null` when it isn't installed (it's an optional dependency). */
function loadSharp(): Promise<any> {
  sharpModule ??= import('sharp').then(m => m.default, () => null)
  return sharpModule
}

async function transcodeToJpg(srcPng: string, dstJpg: string, quality: number): Promise<void> {
  const sharp = await loadSharp()
  if (!sharp)
    throw new Error('`sharp` is required for JPEG share cards')
  await sharp(srcPng).jpeg({ quality, mozjpeg: true }).toFile(dstJpg)
}

/**
 * Where the Worker deploy target goes: next to the build output (`dist` → `dist-worker`), not in
 * it. Inside, its files would be uploaded as assets unless ignored, and `wrangler dev` writes its
 * `.wrangler/` scratch dir next to the config, which its assets watcher then reloads on, forever.
 */
export function workerDirFor(outDir: string): string {
  return `${resolve(outDir)}-worker`
}
// The Workers runtime version the generated `wrangler.jsonc` asks for.
const WORKER_COMPATIBILITY_DATE = '2026-07-01'

export interface WorkerConfig {
  /** Worker name in the generated `wrangler.jsonc`; default the slugified deck title. */
  name?: string
  /** See `publish.worker.renderer`; `undefined` = detect. */
  renderer?: 'browser' | 'none'
}

/** `publish.worker` (`true` or an object), overridden by `--worker` / `--no-worker`; `null` when off. */
export function resolveWorkerConfig(raw: unknown, flag: boolean | undefined): WorkerConfig | null {
  if (flag === false || (!flag && !raw))
    return null
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    renderer: obj.renderer === 'browser' || obj.renderer === 'none' ? obj.renderer : undefined,
  }
}

export function buildWorkerManifest(
  plans: Pick<SlideOgInfo, 'no' | 'slug' | 'title' | 'description' | 'appPath' | 'imageAppPath' | 'contentHash' | 'params'>[],
  opts: {
    baseUrl: string
    appBase: string
    alwaysStamp: boolean
    publicPaths: string[]
    card: WorkerManifest['card']
    hasBareSlug: (p: Pick<SlideOgInfo, 'slug'>) => boolean
  },
): WorkerManifest {
  return {
    version: 1,
    // App paths already include the Vite base, so only a path prefix in `baseUrl` stays in front.
    baseUrl: opts.baseUrl.replace(/\/+$/, ''),
    base: opts.appBase || '/',
    alwaysStamp: opts.alwaysStamp,
    publicPaths: [...new Set(['/_og/*', ...opts.publicPaths])],
    card: opts.card,
    slides: plans.map(p => ({
      no: p.no,
      slug: p.slug,
      title: p.title,
      description: p.description,
      path: p.appPath,
      image: p.imageAppPath,
      hash: p.contentHash,
      bareSlug: opts.hasBareSlug(p),
      ...(Object.keys(p.params).length ? { params: p.params } : {}),
    })),
  }
}

/** `_worker/deck.js`: the manifest, plus the renderer wiring. */
export function renderWorkerDeck(manifest: WorkerManifest, renderer: 'browser' | 'none'): string {
  const browser = renderer === 'browser'
  return `// Generated by \`slidev build --worker\`; rewritten on every build.
${browser ? `import puppeteer from '@cloudflare/puppeteer'\nimport { browserRenderer } from './runtime.js'\n` : ''}
export const manifest = ${JSON.stringify(manifest, null, 2)}

export const renderer = ${browser ? 'browserRenderer(puppeteer)' : 'undefined'}
`
}

// The entry's only export is the handler: workerd reads every named export of the main module
// as an entrypoint, so the manifest lives in `deck.js`.
export const WORKER_ENTRY = `// Generated by \`slidev build --worker\`; rewritten on every build.
//
// To put the deck behind auth, deploy your own entry (outside this directory) instead:
//
//   import { manifest, renderer } from './dist-worker/deck.js'
//   import { createWorker } from './dist-worker/runtime.js'
//   export default createWorker(manifest, { renderer, gate: (request, env, ctx) => ... })
//
// \`gate\` returns a Response (401, a login redirect, ...) for requests it blocks, or nothing.
// \`manifest.publicPaths\` (\`/_og/*\` plus \`publish.publicPaths\`) skip it, and unfurlers it
// blocks get a meta-only page, never the SPA.
import { manifest, renderer } from './deck.js'
import { createWorker } from './runtime.js'

export default createWorker(manifest, { renderer })
`

/** `assetsDir` is the build output, relative to the Worker's directory. */
export function renderWranglerConfig(name: string, renderer: 'browser' | 'none', assetsDir: string): string {
  const browser = renderer === 'browser'
    ? `,
  // Browser Rendering, for cards of non-default URL states.
  "browser": { "binding": "BROWSER" }`
    : `
  // To render cards for non-default URL states, install \`@cloudflare/puppeteer\` in the deck and
  // rebuild (or set \`publish.worker.renderer: browser\`), which adds a \`browser\` binding here.`
  return `// Generated by \`slidev build --worker\`. A template: copy it next to the deck to customize it
// (routes, more bindings), keeping \`main\` and \`assets.directory\` pointed at this directory and
// the build output.
{
  "name": ${JSON.stringify(name)},
  "main": "index.js",
  "compatibility_date": "${WORKER_COMPATIBILITY_DATE}",
  "assets": {
    "directory": ${JSON.stringify(assetsDir)},
    "binding": "ASSETS",
    // The Worker sees every request (to stamp slide pages and render cards), and hands the rest
    // to the assets.
    "run_worker_first": true,
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  }${browser}
}
`
}

function workerRuntimePath(): string {
  // From the built CLI (`dist/*.mjs`) it's a sibling; from source (tests), it's in `dist/`.
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [resolve(here, 'og-worker.js'), resolve(here, '../../dist/og-worker.js')]) {
    if (existsSync(p))
      return p
  }
  throw new Error('[Slidev] Worker: `og-worker.js` not found; build `@slidev/cli` first')
}

export async function writeWorkerBundle(
  outDir: string,
  manifest: WorkerManifest,
  opts: { name: string, renderer: 'browser' | 'none' },
): Promise<void> {
  const dir = workerDirFor(outDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(workerRuntimePath(), resolve(dir, 'runtime.js'))
  await fs.writeFile(resolve(dir, 'deck.js'), renderWorkerDeck(manifest, opts.renderer), 'utf-8')
  await fs.writeFile(resolve(dir, 'index.js'), WORKER_ENTRY, 'utf-8')
  const assetsDir = relative(dir, resolve(outDir)).split(sep).join('/')
  await fs.writeFile(resolve(dir, 'wrangler.jsonc'), renderWranglerConfig(opts.name, opts.renderer, assetsDir), 'utf-8')
}

/** Whether `name` resolves from `root` through `node_modules` dirs, as a bundler would find it. */
function findPackage(root: string, name: string): boolean {
  let dir = resolve(root)
  while (true) {
    if (existsSync(resolve(dir, 'node_modules', name, 'package.json')))
      return true
    const parent = dirname(dir)
    if (parent === dir)
      return false
    dir = parent
  }
}
