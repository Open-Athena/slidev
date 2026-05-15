import type { BuildArgs, ResolvedSlidevOptions, SlideInfo } from '@slidev/types'
import type { ResolvedConfig } from 'vite'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import { resolve } from 'node:path'
import connect from 'connect'
import sirv from 'sirv'

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

function pickSlug(slide: SlideInfo, no: number): string {
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
function firstParagraph(content: string): string {
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

function pickTitle(slide: SlideInfo, deckTitle: string, no: number): string {
  const fm = slide.frontmatter ?? {}
  if (typeof fm.title === 'string' && fm.title.trim())
    return fm.title.trim()
  if (typeof slide.title === 'string' && slide.title.trim())
    return slide.title.trim()
  return `${deckTitle} — Slide ${no}`
}

function pickDescription(slide: SlideInfo): string {
  const fm = slide.frontmatter ?? {}
  if (typeof fm.description === 'string' && fm.description.trim())
    return fm.description.trim()
  return firstParagraph(slide.content)
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Join two URL-ish parts so there's exactly one slash between them (and trailing slashes on
// the base don't cause `//` doubling).
function joinUrl(base: string, path: string): string {
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
  const imageUrl = joinUrl(baseUrl, joinUrl(appBase || '/', `_og/${imageFilename}`))
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
  return { no, slug, title, description, canonical, imageUrl, overrideSrc, imageFilename, htmlFilename, contentHash: slideHash }
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
    return
  }
  const ogCfg = cfg.publish?.ogImage ?? {}
  const size: [number, number] = Array.isArray(ogCfg.size) && ogCfg.size.length === 2 ? ogCfg.size : DEFAULT_OG_SIZE
  const format: 'png' | 'jpg' = ogCfg.format === 'png' ? 'png' : DEFAULT_OG_FORMAT
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

  // Render-key: changes to size/format/wait invalidate the entire cache.
  const renderKey = `${size[0]}x${size[1]}.${format}.w${wait}`

  // Plan each slide first (cheap) so the rest of the function can iterate over a uniform list.
  const plans: SlideOgInfo[] = []
  for (let i = 0; i < options.data.slides.length; i++) {
    const slide = options.data.slides[i]
    const fm = slide.frontmatter ?? {}
    if (fm.skipOg || fm.hide || fm.disabled)
      continue
    plans.push(planSlide(slide, i + 1, deckTitle, baseUrl, appBase, format, renderKey, canonicalForm))
  }

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
          // We requested PNG from exportSlides above; transcode to JPG via sharp if available.
          // Sharp is a transitive dep of common slidev plugins but not a direct one — fall
          // back to copying the PNG (and re-stamping the extension) if sharp isn't there.
          await transcodeOrCopy(src, cache, quality)
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
  let bareSlugCount = 0
  if (existsSync(shellPath)) {
    const baseShell = await fs.readFile(shellPath, 'utf-8')

    // Find slugs that would collide with each other, or with files we already emit
    // (`index`, `404`). Those slides skip the bare-slug alias; their canonical
    // `/<n>-<slug>` still works.
    const slugCounts = new Map<string, number>()
    for (const p of plans) {
      if (p.slug)
        slugCounts.set(p.slug, (slugCounts.get(p.slug) ?? 0) + 1)
    }
    const reservedSlugs = new Set(['index', '404'])

    for (const p of plans) {
      const rendered = injectPerSlideMeta(baseShell, p)
      // Always emit number-only shell (legacy + stable-ordering URL).
      await fs.writeFile(resolve(outDir, `${p.no}.html`), rendered, 'utf-8')
      // Emit canonical `<n>-<slug>.html` when slug present.
      if (p.slug)
        await fs.writeFile(resolve(outDir, `${p.no}-${p.slug}.html`), rendered, 'utf-8')
      // Emit bare `<slug>.html` only when slug is unique + not reserved.
      if (p.slug && !reservedSlugs.has(p.slug) && slugCounts.get(p.slug) === 1) {
        await fs.writeFile(resolve(outDir, `${p.slug}.html`), rendered, 'utf-8')
        bareSlugCount++
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[Slidev] OG: wrote ${plans.length} shell(s) + gallery index + per-slide SPA shells (${plans.length} numbered, ${plans.filter(p => p.slug).length} slugged, ${bareSlugCount} bare-slug), rendered ${toRender.length} new image(s) (${cached.length} from cache) to ${ogDir}`)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Rewrite a single `<meta {attr}="{key}" content="...">` value in-place. Tolerant
// of attribute-order variants (`attr` and `content` may appear in either order
// in source HTML); returns the input unchanged when no matching tag is found.
function replaceMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const v = htmlEscape(value)
  // attr-first: <meta name="x" content="y">
  const re1 = new RegExp(`(<meta\\s+${attr}="${escapeRegex(key)}"\\s+content=")[^"]*(")`)
  if (re1.test(html))
    return html.replace(re1, `$1${v}$2`)
  // content-first: <meta content="y" name="x">
  const re2 = new RegExp(`(<meta\\s+content=")[^"]*("\\s+${attr}="${escapeRegex(key)}")`)
  return html.replace(re2, `$1${v}$2`)
}

// Build a per-slide variant of the SPA shell, mutating only the head meta —
// title, description, og:*, twitter:* — so canonical `/<n>` URLs serve correct
// per-slide share cards to scrapers (browsers boot the SPA from this shell
// exactly as from `index.html`/`404.html`). Idempotent: if the deck-level shell
// already has a meta we'd inject, we replace its value; otherwise we append.
function injectPerSlideMeta(shell: string, info: SlideOgInfo): string {
  let html = shell
  const t = info.title
  const d = info.description
  const u = info.canonical
  const img = info.imageUrl

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${htmlEscape(t)}</title>`)
  html = replaceMeta(html, 'name', 'description', d)
  html = replaceMeta(html, 'property', 'og:title', t)
  html = replaceMeta(html, 'property', 'og:description', d)
  html = replaceMeta(html, 'property', 'og:image', img)
  html = replaceMeta(html, 'property', 'og:url', u)
  // Vite's deck-level shell uses `property="twitter:..."`; the `_og/*.html` shells
  // use `name="twitter:..."`. Try both so we cover whatever the source emits.
  html = replaceMeta(html, 'property', 'twitter:title', t)
  html = replaceMeta(html, 'property', 'twitter:description', d)
  html = replaceMeta(html, 'property', 'twitter:image', img)
  html = replaceMeta(html, 'property', 'twitter:url', u)
  html = replaceMeta(html, 'name', 'twitter:title', t)
  html = replaceMeta(html, 'name', 'twitter:description', d)
  html = replaceMeta(html, 'name', 'twitter:image', img)
  html = replaceMeta(html, 'name', 'twitter:url', u)

  // Canonical link: replace if present, else inject before </head>.
  if (/<link\s+rel="canonical"/.test(html)) {
    html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${htmlEscape(u)}$2`)
  }
  else {
    html = html.replace(/<\/head>/, `<link rel="canonical" href="${htmlEscape(u)}">\n</head>`)
  }

  return html
}

async function transcodeOrCopy(srcPng: string, dstJpg: string, quality: number): Promise<void> {
  try {
    // @ts-expect-error — `sharp` is an optional peer; resolved at runtime if installed.
    const { default: sharp } = await import('sharp')
    await sharp(srcPng).jpeg({ quality, mozjpeg: true }).toFile(dstJpg)
  }
  catch {
    // Fallback: keep the PNG bytes but rename to .jpg so URL/filename stays consistent.
    // OG scrapers parse magic bytes, not extensions, so this still previews correctly.
    await fs.copyFile(srcPng, dstJpg)
  }
}
