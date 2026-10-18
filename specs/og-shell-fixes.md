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
