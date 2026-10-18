# Per-Slide OG Metadata & Social Thread Publishing

Enable a Slidev deck to be posted as a BlueSky (or Mastodon/Fediverse) thread — one post per slide — with rich link previews that show a rendered image of the slide, a custom title/description, and a link back to the live interactive deck at that slide.

## Motivation

A Slidev deck is, increasingly, the primary artifact for a unit of work (a week's update, a design exploration, a hypothesis writeup). It is also the richest version of that content: interactive, up-to-date, and versioned alongside the code. But the social-graph surface for such content is the link preview — a single OG image, title, and description. Today a Slidev deck only exposes OG metadata for the deck as a whole, so sharing "slide 14" in a group chat gets the same preview as sharing "slide 1".

Two capabilities unlock here:

1. **Shareable slides.** Paste a URL to any individual slide into Slack/iMessage/BlueSky and get a preview that shows *that* slide.
2. **Thread publishing.** Convert a deck into an N-post thread where each post embeds the slide image, a short caption, and a link back to the live interactive slide.

## Scope of changes

### A. Per-slide OG metadata

Every slide should be able to declare its own `title`, `description`, and `ogImage` via frontmatter. Defaults:

- `title`: slide's `h1`/`h2`, else `{deck title} — slide {n}`
- `description`: slide's first paragraph text (or `contents` if explicitly set)
- `ogImage`: auto-rendered PNG/JPG of the slide (reuse existing export-to-image pipeline)

Frontmatter example:

```md
---
title: The pitch
description: Why users stop at the paywall 60% of the time
ogImage: ./og/pitch.png   # optional override; otherwise auto-generated
---
```

### B. URLs that actually address slides

Current scheme is `/<n>` (auto-incrementing integer). Add optional **slug** segment:

- Canonical: `/<n>-<slug>` (e.g. `/14-the-pitch`)
- Accept bare `/<n>` (existing behavior — redirects to canonical)
- Accept bare `/<slug>` (new — resolves via a slide-index, redirects to canonical)
- Lex-sorted listing still works because the integer leads

Slug source (in priority order): frontmatter `slug`, slugified `title`, slugified `h1`, fallback `slide-<n>`.

### C. Static prerendered per-slide HTML

The bottleneck for OG previews is that most scrapers don't execute JS. Solution: on `slidev build`, emit a small static HTML **shell** per slide under `/_og/<n>-<slug>.html` that contains:

- `<meta property="og:title|description|image|url">` for that slide
- `<link rel="canonical" href="/<n>-<slug>">`
- An immediate client-side redirect (`<meta http-equiv="refresh">` + JS) to the real SPA URL

Scrapers (which don't follow JS) read the OG tags and stop. Humans land on the shell for ~1 frame, then get redirected into the interactive deck.

Deck-level routing: the SPA's 404/fallback handler already needs to route deep links; extend it to recognize `/<slug>` and `/<n>-<slug>` and redirect to `/<n>`.

### D. Image generation

Reuse the existing `slidev export --format=png` pipeline to emit one PNG per slide at build time, written to `dist/_og/<n>-<slug>.png`. Two knobs:

- `ogImage.size`: default `1200x630` (BlueSky/Twitter/OG standard)
- `ogImage.format`: `png` | `jpg` (default `jpg` for smaller payloads)
- Skip regeneration if slide content hash hasn't changed (cache key = hash of slide source + theme + size)

### E. Thread publishing CLI

```
slidev publish bluesky [--dry-run] [--handle foo.bsky.social]
```

- Reads built deck + OG images
- For each slide, constructs a BlueSky post with:
  - **Text**: slide title (short) or custom `caption` frontmatter field; if neither, falls back to description truncated to 300 chars
  - **Embed**: external link card pointing at `/<n>-<slug>` with the slide's OG image
  - **Reply chain**: each post after the first replies to the previous (making it a thread)
- Authenticates via `BSKY_APP_PASSWORD` env var
- Saves thread URI + post URIs to `dist/_publish/bluesky.json` for idempotent reposting/edits

Mastodon/Fediverse support: same shape, different auth (`MASTODON_TOKEN`, `MASTODON_INSTANCE`). Implement BlueSky first; Mastodon mostly reuses the post-assembly code.

### F. Frontmatter additions

Add to slide frontmatter (optional on every slide):

```text
{
  slug?: string        // URL slug; else auto from title
  title?: string       // OG title; else h1/h2
  description?: string // OG description; else first paragraph
  caption?: string     // social post text; else title
  ogImage?: string     // override OG image path; else auto-rendered
  skipThread?: boolean // omit from published thread
}
```

Add to deck headmatter:

```text
{
  ogImage?: {
    size?: [number, number]  // default [1200, 630]
    format?: 'png' | 'jpg'   // default 'jpg'
    quality?: number         // jpg only, default 85
  }
  publish?: {
    baseUrl: string          // required — absolute URL where deck is hosted
    bluesky?: { handle: string }
    mastodon?: { instance: string; handle: string }
  }
}
```

## Non-goals

- No editing of published threads (v1: publish-only; future: reconcile)
- No video/GIF posts (v1: static images only; interactivity lives at the deck URL)
- No per-post images beyond the slide render (v1)

## Open questions

- **Proxy vs built-in?** A Cloudflare worker that serves OG tags based on the URL and proxies to the SPA would work *without* Slidev changes, but adds a deploy dependency and loses the build-time cache story. Built-in is cleaner if we can stomach the extra files in `dist/`. Recommendation: built-in, because the static shell is one small file per slide and the SEO/social-preview win is generic.
- **Slide-count upper bound?** Decks with 50–100 slides are fine. Decks with 1000+ (unlikely but possible for generated content) would bloat `dist/_og/`. Mitigations: `skipThread: true` per slide, or deck-level `ogImage.only: [1, 5, 12]`.
- **Auth model for `publish`.** App passwords for BlueSky are per-user; this CLI assumes the operator runs it locally. CI publishing is out of scope for v1.
- **Thread-vs-single-post heuristic.** Short decks (<4 slides) might be better as a single post with a carousel. v1: always a thread, user can opt into single-post mode later.

## Implementation phases

1. **Per-slide OG (A + C + D + F-frontmatter).** Prerendered shells + image generation + frontmatter. Delivers the "paste a slide URL and get a preview" win without any social integration. **Shipped.**
2. **Slug URLs (B).** Nice-to-have; can land alongside or after phase 1.
3. **BlueSky publish (E).** CLI command assembling the thread.
4. **Mastodon publish.** Reuse phase 3's post-assembly.

Phase 1 alone is probably the highest-leverage piece — it's what makes the deck behave like a proper web citizen.

## Phase 1 implementation notes (shipped)

Lives in `packages/slidev/node/commands/og.ts`, called from `build.ts` after
the existing Vite + deck-level OG generation. Activated by setting
`publish.baseUrl` in deck headmatter; otherwise skipped silently (so existing
decks are unaffected).

- **Frontmatter additions** in `packages/types/src/frontmatter.ts`:
  - Slide-level: `slug`, `description`, `ogImage` (path override), `caption`
    (forward-compat for thread CLI), `skipOg`
  - Headmatter: `publish.baseUrl` (required; OG `<meta>` URLs need to be
    absolute) and `publish.ogImage: { size, format, quality }` (defaults
    `[1200, 630]`, `'jpg'`, 85). Nested under `publish` to avoid clashing
    with the existing slide-level `ogImage` path-override.
- **Image generation**: re-uses `exportSlides()` infra. Spins up a `sirv`
  server against the freshly-built `dist/`, drives Playwright per-slide
  with `waitUntil: 'load'` + 15 s timeout (`'networkidle'` is too flaky
  for whole-deck builds — Twitter widgets / web fonts / analytics block
  it). Output goes through a `<userRoot>/.slidev/og-cache/<n>-<hash>.jpg`
  cache so subsequent builds skip re-rendering unchanged slides — first
  build of the demo's 17 slides takes ~50 s, second takes ~28 s.
- **Image transcoding**: Playwright export emits PNG; we transcode to JPG
  via `sharp` if available, else fall back to copying the PNG bytes with
  the `.jpg` extension (OG scrapers parse magic bytes, not extensions).
- **Cache key**: `sha1(slideSource + frontmatter + size + format)`. Each
  cache entry is `<n>-<12-hex-chars>.<ext>`. Editing a slide invalidates
  only that slide; resizing invalidates all of them. Old entries
  accumulate (no GC); user can `rm -rf .slidev/og-cache` to reset.
- **HTML shells** are cheap to regenerate, so they're always re-emitted —
  changes to title/description/baseUrl take effect without touching the
  image cache. Format: `<n>-<slug>.html` with `<meta og:*>`,
  `<link rel="canonical">`, `<meta http-equiv="refresh">` + immediate JS
  `location.replace`. Avoids HTTP redirects so OG `<meta>` actually reach
  scrapers (most don't follow 30x).
- **Slug source** (priority order): `frontmatter.slug` → `routeAlias` →
  slugified `frontmatter.title` → slugified `slide.title` (parsed h1) →
  `slide-<n>`. Slugify uses NFKD + Unicode property class `\p{M}` to
  strip combining marks, then collapses non-word chars to dashes.
- **Title / description defaults**: title from `frontmatter.title` or
  parsed h1, else `${deckTitle} — Slide ${n}`. Description from
  `frontmatter.description`, else first paragraph of slide content
  (heuristic: strips fenced code, HTML, headings, list bullets,
  blockquotes; truncates to 300 chars).
- **Skip rules**: `frontmatter.skipOg`, `hide`, or `disabled` skip a
  slide entirely (no shell, no image).
- Demo deck has `publish.baseUrl` set in headmatter as a PoC; running
  `slidev build` in `demo/starter` produces 17 shell+image pairs in
  `dist/_og/`.

### Caveats

- Slug routing (Phase 2) isn't shipped, so the canonical URL embedded in
  shells is the integer route `/<n>` rather than `/<n>-<slug>`. The slug
  is used in shell + image filenames only.
- The cache directory grows monotonically; a future tweak should sweep
  entries not used in the current build.
- 1200×630 with a 16:9 slide canvas produces sidebar letterboxing
  (1.905 vs 1.778 AR); acceptable for OG previews.
