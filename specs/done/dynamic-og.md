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

## As built

### Output
- `publish.worker: true` (or `{ name?, renderer? }`) or `slidev build --worker` (`--no-worker` wins over the headmatter). Needs `publish.baseUrl`; without it the build warns and skips.
- It's written **next to** the build output, as `<outDir>-worker/` (`dist-worker/`), not inside it. Inside `dist/`, the files would be uploaded as public assets unless ignored, and `wrangler dev` writes `.wrangler/` next to its config, which its assets watcher then reloads on, forever (observed). The root `.gitignore` already has `dist-*`; the create-app template's `_gitignore` gains `dist-worker`.
  - `runtime.js`: the Worker, from `packages/slidev/node/worker/runtime.ts`. `@slidev/cli` builds it on its own (`tsdown.worker.config.ts` → `dist/og-worker.js`), so it's one module with no Node or npm imports.
  - `deck.js`: the manifest (per slide: number, slug, title, description, path, card path, content hash, bare-slug flag, params; plus base URL, Vite base, card size / format / quality, `publicPaths`, `alwaysStamp`) and the renderer wiring.
  - `index.js`: the entry, whose only export is the handler. workerd reads every named export of the main module as an entrypoint, and an `undefined` one fails startup, so the manifest is in `deck.js`.
  - `wrangler.jsonc`: a template. Assets at `../dist` bound as `ASSETS`, `run_worker_first: true`, `html_handling: auto-trailing-slash` (so `/3-install` → `3-install.html`), `not_found_handling: single-page-application`. With the browser renderer, it also has a `browser` binding.
- In Worker mode the build doesn't write `_redirects`: Workers assets read it too, and reject the `/* /index.html 200` catch-all as a loop. `not_found_handling` does the SPA fallback.
- Run it with `wrangler dev -c dist-worker/wrangler.jsonc`, and deploy with `wrangler deploy -c dist-worker/wrangler.jsonc`. Nothing here deploys anything.

### Request handling (`createWorker`)
- **Slide URLs** (`/<n>`, `/<n>-<slug>`, and the bare `/<slug>` when it's unique): for an unfurler, matched by user agent (`UNFURLER_RE`, overridable), or for every request with `publish.ogAlwaysStamp`, the Worker fetches the static per-slide shell and re-stamps it with `HTMLRewriter`. Browsers get the static files untouched.
  - The stamped tags are the ones `injectPerSlideMeta` writes, from one shared list (`shareTags` in `node/worker/shared.ts`): `<title>`, `description`, `og:type` / `title` / `description` / `image` / `url`, `twitter:card` / `title` / `description` / `image`, `twitter:url` only when present, and `<link rel=canonical>`. Missing ones are added before `</head>`.
  - `og:url` = canonical slide URL + canonical params. `og:image` = `/_og/<n>-<slug>.<ext>?<canonical params>&v=<content hash>`, or `?v=<hash>` in the default state. It keeps the build's card filename rather than the spec's `/_og/<n>.jpg`, so the URL also resolves on a static host. `/_og/<n>.<ext>` is accepted too.
  - Stamped responses are `Cache-Control: no-cache` without the asset's `ETag`, and the shell fetch drops conditional headers.
- **Cards** (`/_og/<n>[-<slug>].<ext>`): with no non-default params, the pre-rendered card is passed through from `ASSETS` byte-for-byte. Otherwise, the Cache API is checked under the canonical key `<card path>?<canonical query>&v=<current hash>`, so reordered, defaulted or unknown params and stale `v`s share one entry. On a miss the renderer runs, and the result is cached (`max-age=86400`, written in `waitUntil`). With no renderer, no binding, or a render error, the default card's bytes are served with `max-age=300` and `X-Slidev-Card: default`, so a later-bound renderer takes over soon.
- **Params:** `normalizeSlideParams` takes `params: { m: { values: [...], default } }` or the shorthand `m: [a, b]` (the first value is the default). It skips, with a build warning, declarations with no values, a default outside the values, a bad name, or a reserved name (`v`, `print`, `range`, `clicks`, `embedded`, `password`). `canonicalizeParams` keeps only declared params whose value is declared and not the default, sorted by name, using the first of repeated keys. The params are also in the slide's content hash (the frontmatter is hashed), so editing them changes `v`.

### On-demand rendering: option (a), with the default card as the fallback
- `browserRenderer(puppeteer)` loads `<origin><base><n>?<params>&print=true&range=<n>` in Browser Rendering at the card size, waits for `[data-slidev-no=n]` and for `.slidev-slide-loading` to go away (as the build's export does), and screenshots that element (JPEG at the deck's quality, or PNG).
- `@cloudflare/puppeteer` is never bundled into `runtime.js`. `deck.js` imports it when the renderer is `browser`, and wrangler resolves it from the deck's `node_modules`. `renderer` defaults to `browser` when `@cloudflare/puppeteer` resolves from the Worker dir, else `none`. An explicit `browser` without it warns.
- Option (b), a Satori card, isn't built. The fallback is the pre-rendered default card. That's honest about what's shown, and it needs no fonts or Wasm in the Worker.
- **Not exercised for real:** Browser Rendering needs a Cloudflare account. The renderer is unit-tested against a mock `puppeteer`, and the on-demand path (render → cache → hit) against a fake renderer in workerd.
- A slide only looks different in a card once its components read the URL params. That's the use-prms Vue split (`~/c/js/use-prms/specs/vue-bindings.md`), which isn't done; the Worker passes the params through to the render URL.

### Gating: `publish.publicPaths` + the `gate` hook
- Auth isn't built in. A deck behind auth deploys its own entry:
  ```js
  import { manifest, renderer } from './dist-worker/deck.js'
  import { createWorker } from './dist-worker/runtime.js'
  export default createWorker(manifest, { renderer, gate: (request, env, ctx) => ... })
  ```
  `gate` returns a `Response` (401, a login redirect, …) to block, or nothing to allow.
- `manifest.publicPaths` = `/_og/*` plus `publish.publicPaths` (app paths, or prefix globs ending in `*`), which skip the gate. Cards are handled before the gate in any case.
- A blocked unfurler on a slide URL gets a meta-only page (the share tags, an empty body, no SPA bundle). Everyone else gets the gate's response.
- If `SLIDEV_RENDER_TOKEN` is set (a Worker secret), the browser renderer sends it as `X-Slidev-Render-Token`, and requests carrying it skip the gate, so the renderer can load a gated deck.

### Tests
- `test/og-worker.test.ts`: `normalizeSlideParams`, `canonicalizeParams` (the spec's cases: order independence, unknowns dropped, the default state has no params; plus invalid values, repeated keys, `v`), `matchSlide`, `matchCard`, `shareInfoFor` (including a path prefix in `baseUrl` and a Vite base), `renderUrl`, `browserRenderer` (call sequence against a mock), `resolveWorkerConfig`, `buildWorkerManifest`.
- `test/og-worker-miniflare.test.ts`: the generated bundle (`writeWorkerBundle` on a synthetic build output, with shells from `injectPerSlideMeta`) in real workerd via `miniflare` (new root dev dep, `catalog:dev` `^4.20260730.0`; `workerd` added to `allowBuilds`). `ASSETS` is a Node function mimicking Workers assets. It covers:
  - the stamped tags, exactly, for `/2-chart?m=heatmap&x=1`, `/2-chart?x=1&m=heatmap`, `/2?…` and `/chart?…`, and for the default state;
  - tags added to a shell that lacks them, and browsers getting the static files untouched;
  - default-card byte identity across query variants, and the fallback for a parametrized card;
  - render-once-then-cache across equivalent URLs, with a fake renderer;
  - the gate: a meta-only page for unfurlers, the gate's 401 for others, `/_og/*` public, and the render token.
  It needs `@slidev/cli` built (`dist/og-worker.js`), like `api-snapshots.test.ts`. CI builds before testing.
- Checked by hand: a real `slidev build --worker` of `demo/starter`, then `wrangler deploy --dry-run` (the config validates and bundles) and `wrangler dev --local` on :3070:
  - a Slackbot request for `/2?m=x` gets slide 2's tags (`?m=x` is dropped, since the slide declares no params);
  - a browser gets `dist/2.html` byte-identical;
  - `/_og/2-embeds.jpg?v=…` and `/_og/2.jpg` are byte-identical to the build's card;
  - with params hand-added to `deck.js`, both param orders stamp `og:image` = `…/_og/2-embeds.jpg?m=heatmap&v=<hash>`, and the card falls back to the default bytes.
- **Not done:** the spec's E2E "a parametrized unfurl gets a JPEG that differs from the default". That needs Browser Rendering (an account) and slide components that read params (use-prms Vue).

### Risks / follow-ups
- `UNFURLER_RE` is a heuristic. A missed unfurler gets the static shell's default-state tags, which is today's behavior.
- The render URL loads the deck through the Worker on the same origin, so a gated deck needs `SLIDEV_RENDER_TOKEN`. Browser Rendering sessions aren't reused (`puppeteer.connect`), so each cold render pays the launch time.
- `routerMode: hash` decks warn: slide URLs never reach the Worker, and only `/_og/*` is served per request.
- `WORKER_COMPATIBILITY_DATE` (`2026-07-01`) is pinned in `og.ts`. Bump it deliberately.

[og-shell-fixes.md]: og-shell-fixes.md
