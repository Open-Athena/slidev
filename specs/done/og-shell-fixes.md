# OG build fixes: real JPEGs, and per-slide tags that exist even when the deck sets none

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), the first deck besides the demo to turn on `publish.baseUrl`. Two bugs in `packages/slidev/node/commands/og.ts`, both silent.

## 1. `.jpg` cards are PNGs when `sharp` is missing

`transcodeOrCopy` catches the failed `import('sharp')` and copies the PNG bytes to a `.jpg` name (`og.ts`, `transcodeOrCopy`). slidev.oa.dev ships this today: `curl -s https://slidev.oa.dev/_og/1-open-athena-slidev.jpg | file -` says PNG. Most scrapers sniff the magic bytes, but some don't: CDNs and some unfurlers trust the extension or the `Content-Type`, which static hosts set from the extension (`image/jpeg` over PNG bytes). And the "smaller payload" reason for defaulting to jpg is lost.

Fix, in order of preference:
- Make `sharp` a real dependency of `@slidev/cli`, or an optional dependency installed by default. The deck added it as a devDep, and the fork's dynamic import resolves it through pnpm's hoisted store.
- When `sharp` is unavailable: warn once (`[Slidev] OG: sharp not installed; writing PNG cards`), switch the run to `format: png`, and emit `.png` filenames and URLs. Never a mislabeled file.
- Fix slidev.oa.dev's own build: add `sharp` to the demo, or to whatever builds it in CI.

## 2. Per-slide pages get no `og:image` unless the deck already has one

`injectPerSlideMeta` rewrites the SPA shell's tags with `replaceMeta`, which only replaces tags that already exist. The function comment says "otherwise we append", but neither regex branch appends. The base shell (`setups/indexHtml.ts`) only emits `og:image` / `og:url` / `twitter:*` when `seoMeta` (or an `og-image.png`) supplies them. So for a deck without `seoMeta`:
- `dist/<n>.html`, `<n>-<slug>.html` and `<slug>.html` carry only `og:title` and `og:description`. No image, URL or card type, so Slack and others show a text-only unfurl.
- Only `_og/<n>-<slug>.html` has `og:image`, and nothing links unfurlers there.

The deck works around it by setting `seoMeta.ogImage`, `ogUrl`, `twitterCard: summary_large_image` and `twitterImage` in its headmatter, which the per-slide pass then rewrites.

Fix:
- `replaceMeta` appends `<meta {attr}="{key}" content="…">` before `</head>` when neither regex matches.
- Per-slide pages also set `twitter:card` = `summary_large_image` when a card image exists, and `og:type` = `website`.

Test: build a fixture deck with `publish.baseUrl` and no `seoMeta`. Assert that `dist/2.html` contains `og:image` = `<baseUrl>/_og/2-<slug>.jpg`, plus `og:url` and `twitter:card`. Assert that a deck which does set `seoMeta.ogImage` still gets per-slide values (no duplicate tags).

## Smaller notes from the same pass

- Cards render at the slide's aspect ratio (1200×675 for 16:9), not the default `ogImage.size` of 1200×630. Either honor `size` (letterboxing or cropping to 1.91:1), or document that `size` only sets the width.
- `og:description` comes out empty for most slides (the per-slide description is empty). Fall back to the deck's `info` / `seoMeta.ogDescription`, or to the slide's first paragraph.

## As built

- **`sharp`**
  - It's now an optional dependency of `@slidev/cli` (`^0.35.0`, prebuilt binaries, no install script), so it's installed by default.
  - When it can't load, the build warns once (`[Slidev] OG: \`sharp\` isn't installed, so share cards are written as PNG`) and switches the whole run to `format: png`, so names and URLs say `.png`. There's no more copy-as-`.jpg` fallback (`transcodeToJpg` throws if it's somehow reached without `sharp`).
  - The render key gains `.sharp` for JPEGs. Without that, the cache entries written as PNG bytes under `.jpg` names would have been served forever.
  - The demo build now emits 20 / 20 real JPEGs (it was 2 / 20 before the cache-key change).
- **Tags**
  - `replaceMeta` → `setMeta` (exported): rewrites a tag in place under either `name` or `property`, in either attribute order, and otherwise adds it before `</head>`. Replacements use a function, so a `$` in a title can't be read as a replacement pattern.
  - Per-slide pages set `description`, `og:type` (`website`), `og:title` / `description` / `image` / `url`, `twitter:card` (`summary_large_image`) and `twitter:title` / `description` / `image`.
  - `twitter:url`, which isn't a standard tag, is only updated when the deck has it.
- **Description:** slides without their own fall back to `seoMeta.ogDescription`, else the deck's `info` (markdown stripped).
- **Not changed:** `ogImage.size`. It already defaults to 1200×675 (16:9, `og-index-and-404` Phase 0) and is passed to the export as the viewport.
- **Tests:** `test/og.test.ts` `injectPerSlideMeta`:
  - a shell with only `og:title` gets every share-card tag, once each;
  - a deck shell that sets them all (`property="twitter:*"`, one content-first) is rewritten in place with no duplicates.

  Verified with a real `slidev build` of `demo/starter`: `file` on `_og/*.jpg` reports JPEG for all 20, and `dist/2.html` has `og:image`, `og:type` and `twitter:card`.
