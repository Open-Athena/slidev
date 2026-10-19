---
outline: deep
---

# Building and Hosting

Slidev is designed to run as a web server when you are editing or presenting your slides. However, after the presentation, you may still want to share your **interactive** slides with others. This guide will show you how to build and host your slides.

## Build as a SPA {#spa}

You can build the slides into a static [Single-page application (SPA)](https://developer.mozilla.org/en-US/docs/Glossary/SPA) via the following command:

```bash
$ slidev build
```

By default, the generated files are placed in the `dist` folder. You can test the built version of you slides by running: `npx vite preview` or any other static server.

### Base Path {#base}

To deploy your slides under sub-routes, you need to pass the `--base` option. The `--base` path **must begin and end with a slash `/`**. For example:

```bash
$ slidev build --base /talks/my-cool-talk/
```

Refer to [Vite's documentation](https://vitejs.dev/guide/build.html#public-base-path) for more details.

### Output directory {#output-directory}

You can change the output directory using `--out`.

```bash
$ slidev build --out my-build-folder
```

### Remove speaker notes {#without-notes}

If you are sharing the built slides publicly and don't want to include your speaker notes, run the build with `--without-notes`:

```bash
$ slidev build --without-notes
```

### Multiple Builds {#multiple-builds}

You can build multiple slide decks in one go by passing multiple markdown files as arguments:

```bash
$ slidev build slides1.md slides2.md
```

Or if your shell supports it, you can use a glob pattern:

```bash
$ slidev build *.md
```

In this case, each input file will generate a folder containing the build in the output directory.

### Examples {#examples}

Here are a few examples of the exported SPA:

- [Demo Slides](https://sli.dev/demo/starter)
- [Composable Vue](https://talks.antfu.me/2021/composable-vue) by [Anthony Fu](https://github.com/antfu)
- More in [Showcases](../resources/showcases)

### Options {#options}

<LinkCard link="features/build-with-pdf" />
<LinkCard link="features/bundle-remote-assets" />

## Hosting {#hosting}

We recommend using `npm init slidev@latest` to scaffold your project, which contains the necessary configuration files for hosting services out-of-the-box.

### GitHub Pages {#github-pages}

To deploy your slides on [GitHub Pages](https://pages.github.com/) via GitHub Actions, follow these steps:

1. In your repository, go to `Settings` > `Pages`. Under `Build and deployment`, select `GitHub Actions`. (Do not choose `Deploy from a branch` and upload the `dist` directory, which is not recommended.) Alternatively, the `enablement: true` option in `configure-pages` can auto-enable Pages for you.
2. Create `.github/workflows/deploy.yml` with the following content to deploy your slides to GitHub Pages via GitHub Actions.

::: details deploy.yml

```yaml
name: Deploy pages

on:
  workflow_dispatch:
  push:
    branches: [main, master]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v6
        with:
          node-version: 'lts/*'

      - name: Setup @antfu/ni
        run: npm i -g @antfu/ni

      - name: Install dependencies
        run: nci

      - name: Build
        run: nr build --base /${{github.event.repository.name}}/

      - name: Setup Pages
        uses: actions/configure-pages@v6
        with:
          enablement: true

      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

:::

3. Commit and push the changes to your repository. The GitHub Actions workflow will automatically deploy your slides to GitHub Pages every time you push to the `main` branch.
4. You can access your slides at `https://<username>.github.io/<repository-name>/`.

### Netlify

Create `netlify.toml` in your project root with the following content:

::: details netlify.toml

```toml
[build]
publish = 'dist'
command = 'npm run build'

[build.environment]
NODE_VERSION = '24'

[[redirects]]
from = '/*'
to = '/index.html'
status = 200
```

:::

Then go to your [Netlify dashboard](https://netlify.com/) and create a new site with the repository.

### Vercel

Create `vercel.json` in your project root with the following content:

::: details vercel.json

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

:::

Then go to your [Vercel dashboard](https://vercel.com/) and create a new site with the repository.

### Zephyr Cloud {#zephyr-cloud}

To deploy your Slidev deck on [Zephyr Cloud](https://zephyr-cloud.io/), you can add Zephyr support to an existing Slidev project with:

```bash
npx with-zephyr@latest
```

This codemod detects your bundler (Slidev uses Vite) and updates your config for Zephyr Cloud.

After setup, run your normal build command, for example:

```bash
npm run build
```

When the build runs with Zephyr enabled, your app is deployed and Zephyr Cloud returns a preview URL.

::: info
Zephyr Cloud is a bit different from most hosting providers: every `build` run triggers a deployment.
:::

### Cloudflare Workers {#cloudflare-workers}

`slidev build --worker` (or `publish.worker: true` in the headmatter) also writes a [Cloudflare Worker](https://developers.cloudflare.com/workers/static-assets/) next to the build output, in `dist-worker/`. It needs `publish.baseUrl`. The Worker serves `dist/` as static assets, stamps per-slide (and per-URL-state) share tags into slide pages for link unfurlers, and serves each slide's share card at `/_og/<n>-<slug>.jpg`.

```bash
$ slidev build --worker
$ npx wrangler dev -c dist-worker/wrangler.jsonc   # try it locally
$ slidev deploy                                     # deploy it
```

`dist-worker/wrangler.jsonc` is a template, rewritten on every build. In this mode the build doesn't write `dist/_redirects`; the config's `not_found_handling` does the SPA fallback instead.

#### Behind sign-in {#cloudflare-workers-auth}

With `auth: open-athena`, the Worker puts the deck behind [`@open-athena/auth`](https://github.com/Open-Athena/auth). Install it in the deck (it's an optional peer dependency of `@slidev/cli`); its `dist` branch is consumed by SHA:

```bash
$ pnpm add 'github:Open-Athena/auth#0e81feafae4fd54676ec1bc2ea1459e96dd6d887'
```

```yaml
---
publish:
  baseUrl: https://talk.example.org
  worker:
    auth: open-athena # or `slidev build --auth open-athena`
    staffDomain: example.org # accounts at this domain (or a list of domains) get in
    admins: [me@example.org] # always get in, and can mint share links
    publicOg: true # default: cards and slide share tags stay public
---
```

What the Worker does:

- **Signed in** (a `staffDomain` account, an address on the D1 allowlist, or an admin): everything.
- **Share links**: `?key=<token>` is redeemed for a session cookie, and the page reloads without the key. Admins mint links through the library's `/api/auth/*` routes.
- **Google sign-in** at `/auth/google`, once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Without them, the sign-in page says sign-in isn't configured, and share links still work.
- **Signed out**: a slide URL gets its share tags (so link previews work) and a sign-in prompt, with none of the deck's scripts or styles. Other pages get their HTML with every script and stylesheet removed. Anything else (the JS bundles, images, …) is a 401.
- **Public**: the `/_og/*` cards, favicons, and `publish.publicPaths`. With `publicOg: false`, the cards are gated too, and signed-out pages carry no share tags.

Other options: `scope` (the scope a session needs; default `deck`), `database` (the D1 database's name; default `<worker name>-auth`) and `databaseId`.

#### Share links from the deck {#share-links}

Signed in as an admin (an address in `admins`), the deck's controls get a **Get link** button (the link icon; also <kbd>⇧</kbd><kbd>Y</kbd> and the right-click menu). Its dialog mints a share link:

- A link signs whoever holds it in to the **whole deck**. "Opens at this slide" (the default) only picks where it lands, and the preview card it unfurls to; the slide's current URL state (its query) is kept. Or pick the deck's start.
- **Name**: who it's for, shown as the holder in the links table. **Email** (optional) binds the link to that address and adds it to the allowlist, so they can also sign in with Google later; revoking the link doesn't remove it. **Note**: for you. **Expires after** (default 30 days; blank: never) and **unlimited uses** (or a number of sign-ins).
- The link (the slide's URL plus `?key=…`), a copy button and its QR code. It's only shown once.

The dialog's **Links** tab lists the links: holder, note (click to edit), uses, last used, expiry (click to change), created, per-link activity (views, addresses, countries, most-viewed paths) and **Revoke**, which also signs out whoever used the link. Revoked links are hidden unless you tick "show revoked".

The button only appears for admins of a deck built with `auth`; a deck without it never asks who's signed in. For decks with their own command palette, `toggleShareDialog()` (and `canShare`) are exported from `@slidev/client`.

To try it locally without Google or Cloudflare, run the built Worker with `wrangler dev` (a local D1) and a dev sign-in:

```bash
$ slidev build --auth open-athena
$ npx wrangler d1 migrations apply <database> --local -c dist-worker/wrangler.jsonc
$ printf 'SESSION_SECRET=%s\nDEV_ADMIN_EMAIL=you@example.org\n' "$(openssl rand -base64 32)" > dist-worker/.dev.vars
$ npx wrangler dev -c dist-worker/wrangler.jsonc
```

With `DEV_ADMIN_EMAIL` set, requests to `localhost` / `127.0.0.1` are signed in as that address (it must be an admin, a `staffDomain` account or on the allowlist; use an `admins` address to get **Get link**). It never applies off localhost, and it's a `.dev.vars` setting: don't set it on a deployed Worker.

#### `slidev deploy` {#slidev-deploy}

`slidev deploy` deploys `dist-worker/` with wrangler. For a deck behind auth, it first creates the D1 database if it's missing (and writes its id into the generated `wrangler.jsonc`), and applies the library's migrations. After deploying, it sets `SESSION_SECRET` if it isn't set, with a generated value piped to wrangler on stdin. The Worker answers 503 until the secret is set, rather than let anyone in.

```bash
$ slidev deploy --dry-run   # print the plan; runs nothing
$ slidev deploy --wrangler 'scripts/cf.sh wrangler'
```

`--wrangler` (or `$SLIDEV_WRANGLER`) sets the wrangler command, e.g. a wrapper that pins the account. The default is the deck's own `wrangler`, else `npx wrangler`.

One step stays manual: Google's OAuth client. Create one (Web application) in the Google Cloud console, with your deck's origin and the redirect URI `<origin>/auth/google/callback`, then `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. `slidev deploy` prints these at the end.

### Host on Docker {#docker}

If you need a rapid way to run a presentation with containers, you can use the prebuilt [docker image](https://hub.docker.com/r/tangramor/slidev) maintained by [tangramor](https://github.com/tangramor), or build your own.

::: details Use the Docker Image

Just run the following command in your work folder:

```bash
docker run --name slidev --rm -it \
    --user node \
    -v ${PWD}:/slidev \
    -p 3030:3030 \
    -e NPM_MIRROR="https://registry.npmmirror.com" \
    tangramor/slidev:latest
```

**_Note_**: You can use `NPM_MIRROR` to specify a npm mirror to speed up the installation process.

If your work folder is empty, it will generate a template `slides.md` and other related files under your work folder, and launch the server on port `3030`.

You can access your slides from `http://localhost:3030/`

To create an Docker Image for your slides, you can use the following Dockerfile:

```Dockerfile
FROM tangramor/slidev:latest

ADD . /slidev
```

Create the docker image: `docker build -t myslides .`

And run the container: `docker run --name myslides --rm --user node -p 3030:3030 myslides`

You can visit your slides at `http://localhost:3030/`

:::
