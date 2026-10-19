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
