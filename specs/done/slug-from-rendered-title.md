# Slide slugs should come from the title's text, not its markdown

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), 2026-10-19, fork `8d908349`.

A slide titled with a markdown link:

```md
# [`@open-athena/treemap`](https://www.npmjs.com/package/@open-athena/treemap): our own treemap
```

gets the URL `/7-open-athena-treemap-https-www-npmjs-com-package-open-athena-treemap-our-own-tree`. The link target is slugged along with the visible text. The same happens to the per-slide pages and OG card names (`dist/<n>-<slug>.html`, `_og/<n>-<slug>.jpg`) and the QR codes.

## Ask

- **Slug from the title as rendered:** link text only (drop `](…)`), backticks and emphasis markers stripped, HTML tags removed (e.g. `<img>` in a title gives no text). Expected: `7-open-athena-treemap-our-own-treemap`.
- **Truncation:** keep it, but cut at a word boundary.
- **Override:** a per-slide `slug:` frontmatter key, for when the title text makes a poor slug.
- **Old links:** the `/<n>-<slug>` → slide resolution (`91e16861`) should keep accepting the old long form, or at least fall back to the number, so links already shared keep working.
- **Tests:** titles with a link, inline code, emphasis, an `<img>`, and an emoji, each asserting the exact slug.

## As built

- **One slug rule, shared:** `@slidev/parser/utils` exports `titleText` (a markdown title's visible text: link text without its target; images, HTML tags and entities dropped), `slugify` (NFKD, lowercase ASCII words joined by `-`, cut at a word boundary within 80 characters) and `slideSlugs(frontmatter, title)` → `{ slug, aliases }`. The client (`logic/slides.ts`) and the build (`og.ts` `pickSlug`) both use it, replacing the two hand-synced copies.
- **Override:** frontmatter `slug` (already there; now documented with the new rule).
- **Old links (aliases):** a slide's aliases are its frontmatter `aliases` (a string or list; e.g. slugs from before a title change) plus, automatically, the slug the previous rule derived from its markdown title (e.g. `open-athena-treemap-https-www-npmjs-com-package-open-athena-treemap-our-own-tree`).
  - Client: `/<n>-<alias>` resolves (own slugs first, then aliases, each only when unambiguous; else the number), and the URL is rewritten to the slide's current `/<n>-<slug>`. A stale or unknown slug also gets rewritten. A bare `/<alias>` resolves when unique.
  - Build: per-slide pages are also written as `dist/<n>-<alias>.html` (and `dist/<alias>.html` when unique among all slugs and aliases), and cards are copied to `_og/<n>-<alias>.<ext>`, so links and posts already shared keep their card.
  - Worker: the manifest carries `aliases` / `bareAliases`; `matchSlide` and `matchCard` accept them.
- **Tests:** `test/slug.test.ts` (link, inline code, emphasis, `<img>`, entities, emoji, truncation, precedence, aliases incl. the legacy one); `cypress/e2e/examples/slug-urls.spec.ts` (alias, bare alias, stale number; fixture slide 40 has `aliases: [old-forty]`); parser API snapshots updated for the new exports.
