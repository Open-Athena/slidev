# Turnkey deploy: `slidev build --worker` fronted by `@open-athena/auth`

From the disky deep-dive deck (`~/c/oa/disky-deep-dive`), 2026-10-19. Ryan: "let's deploy a Worker-fronted site that oa/auth's … ideally US would make it turnkey to deploy with oa/auth fronting."

## Reference implementation (deck-side, live)

https://disky-demo.oa.dev runs a hand-written Worker over `slidev build` output: the deck's `worker/index.ts`, `wrangler.toml`, `scripts/deploy.sh` and `specs/deploy.md`. Behavior:

- **Public:** `/_og/*.jpg` cards and favicons.
- **Auth routes:** `/auth/google{,/callback}` (`oidcStart` / `oidcCallback`) and `/api/auth/*` (`authRoutes`).
- **Share links:** `?key=<token>` is redeemed (`gate.redeem`), the cookie set, and the URL reloaded without the key.
- **Signed in** (the `deck` scope: the staff domain, the D1 allowlist, admin emails): `env.ASSETS.fetch(req)`.
- **Anonymous page requests:** the page's own built HTML through `HTMLRewriter`. Every `script`, `style`, `link[rel=stylesheet|modulepreload|preload]` and `meta[http-equiv=refresh]` is removed, and the body replaced by a sign-in prompt. So unfurlers get the per-slide `og:*` tags and the deck's JS never reaches anyone signed out.
- **Anything else** anonymous: 401.
- **Deploy gotcha:** `dist/_redirects` (`/* /index.html 200`) has to go; `not_found_handling = "single-page-application"` covers it.

## Ask: make it a build option

- **Config:**
  - headmatter `publish.worker: { auth: 'open-athena', staffDomain: 'openathena.ai', admins: [...], publicOg: true }`;
  - or the CLI: `slidev build --worker --auth open-athena`.
- **Generated:** `dist-worker/index.ts` (or `.js`) and a `wrangler.toml` template. The Worker composes the auth gate above with the existing per-slide card Worker (`--worker`'s `params` cards). Auth gates content; cards stay public when `publicOg`.
- **`slidev deploy`:** a thin wrapper.
  - Runs `wrangler d1 create` if the database is missing.
  - Applies the auth migrations from `@open-athena/auth/migrations`.
  - Sets `SESSION_SECRET` if unset, generated and piped on stdin.
  - Runs `wrangler deploy`.
  - Prints the one manual step: the Google OAuth client. Use auth's `scripts/provision-oauth-client.mjs`, which still needs a `--worker` target in place of `--pages-project`; that's for the auth repo.
- **Without Google:** the page should say sign-in isn't configured, and share links should still work, as the deck's does.
- **`@open-athena/auth`** is an optional peer dependency, loaded only when `auth` is set. Its `dist` branch is consumed by SHA.

## dOGIs

Per-slide static cards cover most of the deck. Two places where dynamic cards would add something:

1. **Slides with URL state** (`params:` frontmatter, already in `--worker`): cards rendered via Browser Rendering.
2. **Slides showing live data from disky deploys.** In this deck, `<OgPreviews>` / `<OgGallery>` pull disky's live dOGIs, and `/meta`'s data is a build-time snapshot. Here the card could proxy or embed the upstream dOGI rather than re-render. Low priority; static is fine for now.

## Tests

- A Miniflare test of the generated Worker:
  - anonymous `/<n>` returns 200 with that slide's `og:image` and no `<script>`;
  - `/_og/<n>-<slug>.jpg` returns 200 `image/jpeg`;
  - anonymous `/assets/*.js` returns 401;
  - with a session cookie signed with the test secret, `/` and `/assets/*.js` return 200;
  - a `?key=` share link returns 302 with `set-cookie`.
- A dry-run `slidev deploy` prints its plan without calling Cloudflare.

## As built

### Config
- `publish.worker: { auth: 'open-athena', staffDomain, admins, publicOg, scope, database, databaseId }`, or `slidev build --auth open-athena` (which implies `--worker`; `--no-worker` still wins). Types in `packages/types/src/frontmatter.ts`, schema regenerated.
  - `staffDomain`: a string, a comma-separated string, or a list. `scope` defaults to `deck`, `database` to `<worker name>-auth`.
  - An unknown `auth` provider throws, and so does `auth` without `publish.baseUrl`. Either would otherwise build a deck with no gate, or leave a stale one in `dist-worker/`.
  - Without `staffDomain` and `admins`, the build warns: only the D1 allowlist could sign in, and nobody could mint links.
- `@open-athena/auth` is an optional peer of `@slidev/cli` (`*`). The workspace consumes its `dist` branch by SHA (`github:Open-Athena/auth#0e81fea…`, as the deck does), from the `dev` catalog, as a dev dep of `@slidev/cli` and the root. With only the peer, pnpm tried to resolve it from the registry.

### Generated (`dist-worker/`)
- `runtime.js` is now built from `node/worker/index.ts` (`runtime.ts` + `auth.ts`), still one module with no npm imports.
- The auth `index.js` (`AUTH_WORKER_ENTRY`) imports the named functions it needs from `@open-athena/auth`, `/d1` and `/oidc`, which wrangler bundles from the deck's `node_modules`, and passes them as `lib` to `createAuthWorker(manifest, { renderer, auth, lib })`. That's the same pattern as `@cloudflare/puppeteer` for the renderer.
- `deck.js` adds `auth = { provider, scope, title }`. The title is the deck's, shown on the sign-in page.
- `wrangler.jsonc` gains:
  - `d1_databases`: `DB`, the database name, `database_id` (`set-by-slidev-deploy` until `slidev deploy` fills it in, or `databaseId`), and `migrations_dir` (the auth package's `migrations/`, relative to the config);
  - `vars`: `STAFF_DOMAIN` (comma-joined), `ADMIN_EMAILS`;
  - a comment listing the secrets.
- `deploy.json`: name, `baseUrl`, Vite base, config and assets paths, and the auth database / id / migrations dir. That's everything `slidev deploy` reads.

### Request handling
- `createWorker` changes, for any gate:
  - the gate now sees every request, of any method and on any path (before, non-GET and out-of-base requests skipped it). The auth routes need POSTs.
  - The gate gets a 4th argument, `GateInfo { slide, share, unfurler, base }`.
  - What it lets through is re-headed `Cache-Control: private, no-cache`.
  - `manifest.publicCards` (from `publicOg`, default `true`): when `false`, `/_og/*` isn't in `publicPaths`, cards go through the gate, and blocked unfurlers get the gate's response, not the meta-only page.
- `authGate` (`node/worker/auth.ts`):
  1. Without `SESSION_SECRET` or `DB`: 503, failing closed.
  2. `<base>auth/google{,/callback}` → `oidcStart` / `oidcCallback`, only when `GOOGLE_CLIENT_ID` and `_SECRET` are set.
  3. `<base>api/auth/*` → `authRoutes`, with `d1AuditQuery` and `d1Allowlist`.
  4. `?key=` on a GET from a non-unfurler → `gate.redeem` → 302 to the URL without the key, with `Set-Cookie`. A failed redeem shows its reason on the sign-in page. Unfurlers don't redeem, which would spend a capped link. The library still authenticates a `?key=` per request, so an unfurler holding a valid link gets the stamped shell.
  5. `authenticate` + `hasScope(scope)` → allowed.
  6. Otherwise:
     - a slide URL (with `publicCards`) gets `metaOnlyShell(share, signInBody)`, whose tags follow the URL's params;
     - other pages (no file extension) get their own HTML through `HTMLRewriter`, with `script`, `noscript`, `style`, stylesheet / preload / prefetch / modulepreload links and `meta[http-equiv=refresh]` removed and the body replaced by the prompt. Without `publicCards` it's always the base `index.html`, also stripped of `og:` / `twitter:` tags.
     - Anything else: 401. Anonymous pages are `no-store` and `X-Robots-Tag: noindex`.
- The sign-in prompt links to `<base>auth/google?next=…` when Google is configured; otherwise it says "Sign-in isn't configured yet; use a share link." It also shows `?denied=` from the OIDC callback.
- Favicons (`/favicon.{ico,svg,png}`, `/apple-touch-icon*`) are public in auth mode, as in the reference.

### `slidev deploy` (`node/commands/deploy.ts`)
- `slidev deploy [-o dist] [-n/--dry-run] [--wrangler <cmd>]`. It deploys an existing build: run `slidev build --worker` first. It doesn't build.
- Plan (`deployPlan`):
  1. remove `dist/_redirects` if present;
  2. auth only:
     - unless `databaseId` is set: `d1 list --json`, then `d1 create` if the database is missing, and its id written into `wrangler.jsonc`;
     - `d1 migrations apply <db> --remote -c …`;
  3. `deploy -c …`;
  4. auth only: `secret list -c … --format json`, then `secret put SESSION_SECRET` with 32 random bytes (base64url) on stdin if it's missing. This runs after the deploy because `secret put` on a missing Worker prompts to create it; until it's set, the Worker answers 503.
- At the end, it prints the manual Google step: the OAuth client's origin and redirect URI, and the two `secret put`s. Auth's `provision-oauth-client.mjs` still lacks `--worker`; that's for the auth repo.
- `--dry-run` prints the plan with each step's condition and runs nothing. That was the only mode exercised against the real CLI here; nothing here has called Cloudflare.
- The wrangler command: `--wrangler`, else `$SLIDEV_WRANGLER` (e.g. `scripts/cf.sh wrangler`), else the nearest `node_modules/.bin/wrangler`, else `wrangler` on `PATH`, else `npx wrangler`.

### Tests
- `test/og-worker-auth.test.ts` (18 tests): the generated entry, bundled with esbuild against the installed `@open-athena/auth`, in Miniflare with a local D1 and the library's migrations applied. The secret is generated per run.
  - Anonymous `/2-chart` gets 200 with exactly that slide's tags, the sign-in body, and no `<script>`. The unfurler `/2?m=heatmap` gets the param tags.
  - `/_og/2-chart.jpg` is 200 `image/jpeg`, byte-identical. Anonymous `/` gets the exact stripped page. Anonymous `/assets/index.js` is 401.
  - With a cookie signed with the test secret, `/` and `/assets/index.js` are 200. That covers staff domains and admins; outsiders and forged cookies get 401.
  - `/api/auth/whoami` (anonymous and signed in), and a POST to `logout`.
  - A minted `?key=` gives a 302 with `Set-Cookie`, the cookie works, and `redeems` is 1. An unfurler with a key spends nothing. A bad key shows its notice.
  - With Google configured: the button, and `/auth/google` redirecting to Google with the right `redirect_uri`.
  - `publicOg: false`: cards are 401, and anonymous pages carry no tags. With no secret: 503, and cards still public.
- `test/deploy.test.ts` (14 tests): `deployPlan`, `describePlan` (exact text), the wrangler output helpers, `resolveWrangler`, and `runDeploy` / the CLI against a stub wrangler that records argv (and only the length of stdin).
  - First deploy: create, list, migrate, deploy, list, put. `database_id` is filled in, and `_redirects` is removed.
  - Redeploy: no create, no put. Missing migrations: an error before any call.
  - `slidev deploy --dry-run` prints exactly `describePlan`'s text and makes no calls.
  - No Worker: an error asking for a build.
- `test/og-worker.test.ts`: `resolveWorkerConfig` auth cases (including the unknown-provider error), and `publicCards: false`.
- Checked by hand: `slidev build --worker --auth open-athena` of `demo/starter` writes the expected `dist-worker/` (no `_redirects`), and `slidev deploy --dry-run` on it prints the plan.

### Not done / open
- **dOGIs item 2** (proxying disky's live dOGIs): skipped, as the spec says it's low priority. Item 1 is the existing `--worker` `params` + Browser Rendering path, unchanged. With auth on, the renderer still needs `SLIDEV_RENDER_TOKEN` to load the gated deck.
- **Unverified against real wrangler**: the exact flags `d1 list --json` and `secret list --format json`, and that `d1 migrations apply` doesn't prompt when stdin isn't a TTY. The stub encodes what I expect from wrangler 4.
- **First share link without Google**: minting needs an admin session, which needs Google (or a cookie minted out of band). A `slidev deploy --mint <name>` (or an auth-repo CLI) would close that gap.
- No `[env.dev]` / custom-domain `routes` in the generated config. Copy the template next to the deck to add them, as before.
- The anonymous slide page uses the meta-only shell, not the page's own stripped HTML as the reference does, so its tags follow the URL's params. Favicon `<link>`s from the deck's head aren't carried over to it.
