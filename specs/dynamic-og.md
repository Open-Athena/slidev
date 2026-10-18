# Dynamic per-slide OG cards (dOGIs), including per-slide URL state

From the disky deep-dive deck. Today `slidev build` pre-renders one card per slide (`_og/<n>-<slug>.jpg`, see [og-shell-fixes.md]). Ryan wants the dOGI pattern his other sites use: a Worker answers every page request, stamps per-URL `og:*` tags into the HTML, and renders the card for that exact URL on demand. That includes interactive state in the URL, so a shared link's card shows what the sharer was looking at.

## Why

- Slides can be interactive: the deck's branch-harmony slide has mode toggles (bubbles / heatmap / ±), and the deployments table could take a sort or a highlighted column. A link to `/16?m=heatmap` should unfurl as the heatmap, not the default view.
- Pre-rendering every state isn't feasible. Pre-rendering just the defaults (today's build) stays as the cache-warm baseline.

## Shape

- A **Worker + static assets** deploy target for `slidev build`. It's the fork's own, optional: `slidev build --worker` or `publish.worker: true`. Its output:
  - `dist/` (as today) plus a `worker.ts` that:
    1. For a slide URL from an unfurler, or any request when `publish.ogAlwaysStamp` is set: serves the SPA shell with per-slide tags rewritten by `HTMLRewriter` (the same tags `injectPerSlideMeta` writes, computed per request). `og:image` = `/_og/<n>.jpg?<canonicalized slide params>&v=<content hash>`.
    2. `/_og/<n>.jpg?…`: if there are no params and a pre-rendered card exists, serve it. Otherwise render on demand and cache it (CF Cache API, keyed on the canonical URL + content hash).
  - The pre-rendered default cards stay as the fast path.
- **On-demand rendering options** (pick one and document it):
  - (a) Browser Rendering API (`@cloudflare/puppeteer`) loading the deck at that URL in print mode, clipped to the slide. The most faithful option; it costs Browser Rendering minutes, and cold starts take seconds (OK for unfurls).
  - (b) A Satori/resvg card from slide metadata (title, a thumbnail of the default render, the state's labels). Cheap and fast, but not a true render of the state.
  - Recommend (a), with (b) as the fallback when Browser Rendering isn't bound.
- **Per-slide URL state:**
  - Slides declare their params (name, codec, default) so the Worker can canonicalize them: drop defaults, sort, reject unknowns. That keeps card cache keys stable and unforgeable.
  - Use use-prms' codecs here, but use-prms is React-only today. This depends on the Vue split specced in `~/c/js/use-prms/specs/vue-bindings.md` (`use-prms/core` codecs + `use-prms/vue` `useUrlState`).
  - Until then, a slide can declare params in frontmatter (`params: { m: { values: [bubbles, heatmap, pm], default: bubbles } }`), and the Worker canonicalizes from that.
- **Gating:** a deck behind auth, like the deep-dive deck behind `@open-athena/auth`, must leave `/_og/*` and the meta-only shell open to anonymous requests. Never serve the SPA bundle to them. Make that a documented hook (`publish.publicPaths`) rather than baking auth into the fork.

## Tests

- **Canonicalization:** `/16?m=heatmap&x=1` and `/16?x=1&m=heatmap` produce the same `og:image`; unknown params are dropped; the default state carries no params.
- **Fallback:** with no params, the Worker serves the pre-rendered card byte-for-byte.
- **E2E on a fixture deck:** (Miniflare/wrangler dev) an unfurler request for a parametrized slide gets a 1200×630 JPEG that differs from the default card.

[og-shell-fixes.md]: og-shell-fixes.md
