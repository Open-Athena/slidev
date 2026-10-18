# `_og/index.html` listing + a real `404.html`

Two related polish items for the static build output (GH Pages target).

## Motivation

- Visiting `https://slidev.oa.dev/_og/` was expected to show a directory listing
  / thumbnail gallery of every slide's OG preview. GH Pages returns 404 (no
  `index.html` at that path), and the browser falls through to slidev's
  `404.html` — which is currently a byte-identical copy of `index.html` (the
  SPA bootstrap). The SPA boots at path `/_og/`, the router matches `/:no`
  with `no = '_og'`, `play.vue` can't parse that as a slide number and quietly
  forwards to `/1`. So unknown paths land at the deck with no signal that
  anything went wrong — confusing for both humans and crawlers / link-checkers.
- The per-slide OG images already exist (`_og/<n>-<slug>.jpg`) and are useful
  as a visual deck index. Surfacing them at `_og/` for free is low-cost.

## Phase 1 — `_og/index.html` thumbnail gallery

Build-time output written from `generateOgShells` in
`packages/slidev/node/commands/og.ts`. After the per-slide shells + images are
written, emit one extra static HTML page at `<outDir>/_og/index.html` listing
every successful entry.

### Contents

Each card in the gallery:

- Thumbnail (`<img loading="lazy">`) of the per-slide OG image — wrapped
  in a `<button popovertarget="lb-N">` so clicking opens a full-size
  lightbox of the image.
- Slide number + title + slug.
- Action row with two affordances:
  - `slide` icon link to the canonical slide URL (same target that the
    per-slide OG shell redirects to).
  - `image` icon button (mirrors thumb click — also opens the lightbox,
    for discoverability).

### Lightbox

Implemented with the HTML `popover` attribute (baseline since 2024) —
**no JS**. Each thumbnail's `popovertarget="lb-N"` opens the
corresponding `<div id="lb-N" popover>`. The image inside is wrapped in
a `popovertargetaction="hide"` button so clicking the image closes the
lightbox; ESC + click-on-backdrop also close (popover-auto default).

Header / metadata:

- Deck title, link back to the deck root (`/`)
- Total slide count + per-slide image dimensions
- Note that these are the OG share-card previews, with a one-liner link to
  `specs/done/per-slide-og.md` for context

Page is self-contained — no script tags, no font dependencies, ~minimal
inline CSS. The same dark `system-ui` style as the existing OG redirect
shell. Renders fine without JS so crawlers + curl get a usable page.

### When to emit

- Only when `publish.baseUrl` is set (same gate as the rest of `og.ts` —
  unconfigured decks already short-circuit). Don't add a separate gate.
- Always re-emit (cheap), like the per-slide shells. No caching needed.
- Skip slides that are skipped from OG generation (`fm.skipOg | hide |
  disabled`) — the gallery should mirror what's actually present in `_og/`.

### Scope discipline

- **No** filter / sort UI, no search. It's a static listing.
- **No** Vue / runtime. Pure HTML string built in node like the existing
  `renderShell`.
- **No** per-slide JS metadata embed (title / description) beyond what's
  already on the OG shell.

## Phase 2 — Route-only fix for the "silent rewrite to deck" bug

**Original plan**: emit a static `404.html` (not the SPA shell). Rejected
during implementation — that approach breaks GH Pages deep-linking. GH
Pages serves `404.html` for *every* path it can't find on disk, and slidev
has no per-slide HTML files: `/1`, `/2`, … only work because the SPA
bootstraps from a `404.html` that's a copy of `index.html`. Replacing it
with a static page would 404 every deep link.

**Real root cause** of the symptom: the SPA's `play` route is `/:no`,
which matches *any* single-segment path. Visiting `/_og` matched
`:no = '_og'`, `play.vue` couldn't parse a slide number out of it and
silently fell back to slide 1. The SPA's existing `404.vue` (already a
real 404 page) only fired for multi-segment paths.

**Fix**: constrain `:no` to digits in `packages/client/setup/routes.ts`:

```ts
path: '/:no(\\d+)'
```

Single-segment non-numeric paths (`/_og`, `/sitemap`, `/foo`) now fall
through to the `NotFound` catch-all → `404.vue` renders with "Page /foo
not found", same as multi-segment paths already did. GH Pages still
serves `404.html` (= SPA shell) for unknown paths, the SPA boots, and the
router lands on `404.vue` — exactly the GH Pages SPA pattern, just no
longer hijacked by the over-broad `:no` match.

### What about HTTP 404 status

GH Pages returns HTTP 404 for paths with no file on disk (even when it
serves `404.html`). So `curl -I` of `/foo` returns `404` while the page
body is the SPA shell → SPA renders the 404.vue UI. The 200 vs 404 was
never the bug; the silent-rewrite-to-slide-1 was.

### Interaction with `_redirects`

`commands/build.ts` writes a Netlify-style `_redirects` (`/*  /index.html
200`) for SPA hosts. Leave unchanged — same architecture, same fix
applies once `/:no(\\d+)` lands.

## Phase 0 — `DEFAULT_OG_SIZE` to 16:9

Change `DEFAULT_OG_SIZE` in `packages/slidev/node/commands/og.ts` from
`[1200, 630]` to `[1200, 675]` so the export AR matches the slide canvas
(16:9). Removes off-theme pillarbox margins on the OG image. Platforms that
strictly want 1.91:1 (Facebook, LinkedIn) center-crop the difference —
~22 px equivalent off top + bottom — which leaves the slide title row
intact in the visible OG card.

Existing decks can still override via `publish.ogImage.size`.

## Out of scope (followups)

- Per-slide HTML shell at `/_og/<n>-<slug>` returning a real listing entry
  with prev/next nav. The current shells redirect via meta refresh + JS;
  that's intentional for OG scrapers and shouldn't change.
- A higher-fidelity gallery (interactive filters, thumbnail crops, ratio
  variants). Not needed; users wanting that should view the deck.
- A `sitemap.xml`. Possible later, separate spec.

## Open questions

- Should the gallery thumbnails be the slug-named `.jpg` (1200×630-ish) or
  a smaller variant? Default to the full-resolution image with `loading=
  "lazy"` and a CSS-sized container — re-rendering at thumbnail size is
  extra build cost for low value.
- Should the 404 page link to the OG gallery? Soft yes — discoverability is
  near-free.
