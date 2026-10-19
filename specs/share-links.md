# Share links: mint and manage `@open-athena/auth` links from the deck

Ryan, 2026-10-19: "can hovering the QRs offer 'mint a share link' nonce-generation? oa/auth has controls for this and disky and others use them powerfully in their /admin console … give access to either the current slide or the whole deck … fill in the user info for whoever receives the link." Follow-up: put "Get link" in the Slidev controls (not on the slide), with a modal that explains what the link grants; per-slide bundles possibly as an option.

Builds on `slidev build --worker --auth open-athena` (`specs/done/worker-auth-deploy.md`): the Worker mounts `authRoutes` at `<base>api/auth/*`, and only `ADMIN_EMAILS` accounts (scope `*`) can mint.

## Phase 1 (MVP)

- **Where:** a "Get link" action, shown only to a signed-in admin of an auth-gated deck (`GET api/auth/whoami` has `*` or `admin`):
  - a nav-bar button, a ⌘K / context-menu action (`toggleShareDialog` exported for decks' own palettes), and a hotkey if a free one fits.
  - Not shown in the dev server unless the dev auth below is on, nor on decks without `auth`.
- **Modal** (`ShareLinkDialog.vue`):
  - **Explanation:** a link signs its holder in to the whole deck; "opens at this slide" only picks where it lands (and its preview card).
  - **Lands on:** this slide (default) or the deck's start.
  - **Recipient** (disky's `/admin` form): name (`subjectName`), email (optional; binds the link to that address, `allowlist: true`), note, expiry (default 30 days; `expiresInS`), unlimited uses.
  - **Mint:** `POST api/auth/grants` with `scopes: [<the deck's scope>]`. Show the link (the slide's canonical URL plus `?key=`), a copy button, and its QR (reuse `SlideQR`'s renderer). The token is only ever shown here.
- **Links table** (`/links` route or a tab of the modal, admin only), after disky's `AdminPage.tsx`: holder (name / email), note (editable, `PATCH`), uses / last used, expiry (editable), created; revoke (`POST /grants/:id/revoke`), with a "show revoked" toggle. Activity per link if the audit route answers (it does in the generated Worker).
- **Client code:** local `fetch` wrappers in `packages/client/logic/auth-client.ts`, shaped like the proposed `@open-athena/auth/client` (`~/c/oa/auth/specs/client-module.md`); switch to the package when it ships.
- **Local testing without Google or Cloudflare:** `wrangler dev` of the generated Worker (local D1, migrations applied) plus a dev sign-in: when the request is from localhost and `DEV_ADMIN_EMAIL` is set, `gate.signIn` that email, as disky's `site/functions/api/auth/[[path]].ts` does. Never active off localhost.

## Phase 2 (opt-in): links for one slide only

Slidev already builds each slide as its own chunk (`slides.md__slidev_<n>`), so a link can be limited to some slides without a new bundling scheme:

- the grant gets an extra scope `slide:<slug>`; the Worker serves the shared app chunks plus only those slides' chunks (needs a chunk → slide map from the build), and the client shows (and navigates) only the allowed slides;
- the shared slide index carries every slide's title and frontmatter, and notes may be in it: strip what a restricted session mustn't see;
- the modal's "Lands on" becomes "Access: whole deck / this slide only".

## Tests

- Unit: the wrappers' request shapes; the share URL (slide's canonical path + `key`, existing query kept).
- Worker (Miniflare, as `test/og-worker-auth.test.ts`): an admin session mints via `api/auth/grants`; the minted `?key=` on a slide URL redeems and lands there; a non-admin gets 403; the dev sign-in works only for localhost.
- E2E against `wrangler dev`, or Cypress with the auth routes stubbed: the button only for admins; mint fills the link and QR; revoke from the table.

## As built (Phase 1)

### Gating
- Build-time defines `__SLIDEV_FEATURE_AUTH__` / `__SLIDEV_AUTH_SCOPE__` (`node/options.ts` `authScopeFor`), from `publish.worker.auth` or `slidev build --auth` (now passed into `resolveOptions` with `--worker`). `resolveWorkerConfig` moved to `node/worker-config.ts` (re-exported from `commands/og.ts`) so `options.ts` can use it without the OG pipeline.
- Off: no `whoami` request, nothing rendered, the dialog chunk is never loaded. On: `Controls.vue` asks `api/auth/whoami` once (`probeAuth`) and lazily loads `ShareLinkDialog.vue` only when the answer has `*` or `admin` (`canMintLinks`).
- In the dev server the flag follows the headmatter too, but the dev server has no auth routes, so `whoami` gets the SPA's HTML and nobody is an admin. `SLIDEV_AUTH_UI=1` forces the flag on in dev (scope `deck`) without a gate: the Cypress fixture's `dev` script sets it, and its spec stubs every `api/auth/*` route.

### Client
- `logic/auth-client.ts`: `createAuthClient({ basePath, fetch })` with `whoami`, `logout`, `grants.{mint,list,update,revoke,disable,enable,rotate,activity}`, `log`; `AuthClientError { status, body }` for non-2xx (and for a non-JSON answer); `shareUrl(token, target)`; `canMintLinks`, `holderOf`. Shaped like `~/c/oa/auth/specs/client-module.md`; swap for `@open-athena/auth/client` when it ships.
- `logic/share-link.ts`: `landingUrl` (the slide's `getSlidePath` under `BASE_URL` / `#/`, with the current query minus `key`; or the deck's start), `mintInputFor` (the form → `POST grants`), date helpers.
- `composables/useShareLinks.ts`: `authWhoami`, `canShare`, `showShareDialog`, `shareTab`, `probeAuth`, `toggleShareDialog(tab?)`. `toggleShareDialog` and `canShare` are exported from `@slidev/client`.
- Entry points: a nav-bar `IconButton` (`i-carbon:link`, `shortcut="share_link"`), `⇧Y` (next to `y`, which copies the plain URL), and two context-menu items ("Get link…", "Manage share links"). All admin-only, none in embeds.
- `ShareLinkDialog.vue` (in `Modal`), two tabs:
  - **New link**: the explanation, "Opens at" (this slide / the deck's start), name (`subjectName`), email (also `allowlist: true`, as disky does), note, expiry in days (default 30, blank = never), unlimited uses (else `maxRedeems`). Always sends `avatar: null`: there's no avatar UI, and without it the Worker would fetch the email's Gravatar. Result: the URL, a Copy button (`navigator.clipboard`, then a `showNotice`), the QR (`uqr`'s `renderSVG`, as `SlideQR`), "Make another".
  - **Links**: newest first; holder (+ email), note (click to edit, `PATCH {note}`), uses (`redeems[ / maxRedeems]`), last used, expiry (click for a date input, `PATCH {expiresAt}` at the end of that local day; cleared = never), created, Activity (expands `grants/:id/activity`; a 501 says there's no access log), Revoke (confirm; `POST …/revoke`). Revoked links are hidden behind "show revoked (n)".

### Worker
- `DEV_ADMIN_EMAIL` (`node/worker/auth.ts`): on a request whose hostname is `localhost`, `127.0.0.1` or `[::1]`, with no session and no `?key=`, `gate.signIn(DEV_ADMIN_EMAIL)`. The cookie is threaded into the request; API answers get `Set-Cookie` appended; a page GET answers 302 to itself with `Set-Cookie`; assets just pass. The policy still applies (an address it doesn't admit gets nothing). Mentioned in the generated `wrangler.jsonc`'s comment and the docs.

### Tests
- `test/share-links.test.ts` (10): every wrapper's method / path / headers / body against a recording `fetch`; 401 / 403 / 404 / 501 and a non-JSON answer as `AuthClientError`; `canMintLinks`; `shareUrl` (query and hash kept, an old `key` replaced); `landingUrl` (base, hash routing, query kept minus `key`, deck start); `mintInputFor` (defaults, trimming / lowercasing, caps, bad input); `holderOf`, `endOfDay`.
- `test/og-worker-auth.test.ts` (+4, now 22): an admin mints through `POST api/auth/grants`, the `?key=` on `/2-chart?m=heatmap` redeems and lands there, the list shows one use, activity answers, revoke makes the key fail with its notice; a staff account gets 403 and an anonymous one 401; with `DEV_ADMIN_EMAIL`, `localhost` and `127.0.0.1` are signed in (whoami, page 302 + cookie, mint), while `https://deck.example` (even with `Host: localhost` headers) gets 401 and no cookie.
- `cypress/e2e/examples/share-links.spec.ts` (4, auth routes stubbed, clipboard stubbed): no button or `⇧Y` for anonymous or staff, a button for admins; mint at `/3?m=heatmap` sends the exact body and shows `…/3?m=heatmap&key=…`, the QR and a copy; mint to the deck's start with email and a cap; the table hides revoked links, edits a note, and revokes.
- Not run: `wrangler dev` against the built Worker (Miniflare covers the same code path).

### Open
- The link grants the whole deck; Phase 2 (per-slide scopes) remains.
- The email checkbox isn't separate: an email always means `allowlist: true` (disky's behaviour). Revoking the link leaves the allowlist row.
- No rotate / disable in the table yet (the wrappers exist).
