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
