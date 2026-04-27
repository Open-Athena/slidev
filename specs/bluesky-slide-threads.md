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

```ts
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

```ts
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

1. **Per-slide OG (A + C + D + F-frontmatter).** Prerendered shells + image generation + frontmatter. Delivers the "paste a slide URL and get a preview" win without any social integration.
2. **Slug URLs (B).** Nice-to-have; can land alongside or after phase 1.
3. **BlueSky publish (E).** CLI command assembling the thread.
4. **Mastodon publish.** Reuse phase 3's post-assembly.

Phase 1 alone is probably the highest-leverage piece — it's what makes the deck behave like a proper web citizen.
