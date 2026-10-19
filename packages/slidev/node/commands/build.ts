import type { BuildArgs, ResolvedSlidevOptions } from '@slidev/types'
import type { InlineConfig, ResolvedConfig } from 'vite'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import connect from 'connect'
import { join, resolve } from 'pathe'
import sirv from 'sirv'
import { build as viteBuild } from 'vite'
import { resolveViteConfigs } from './shared'

export async function build(
  options: ResolvedSlidevOptions,
  viteConfig: InlineConfig = {},
  args: BuildArgs,
) {
  const indexHtmlId = resolve(options.userRoot, 'index.html')

  let config: ResolvedConfig = undefined!
  // `_publish/` holds `slidev publish` state (the posted thread's URIs); Vite empties the out dir,
  // so carry it over or the next publish would post the whole thread again.
  let publishFiles: Map<string, Uint8Array> | undefined

  const inlineConfig = await resolveViteConfigs(
    options,
    {
      plugins: [
        {
          name: 'slidev:build',
          configResolved(_config) {
            config = _config
          },
          async buildStart() {
            publishFiles = await readFlatDir(resolve(options.userRoot, config.build.outDir, '_publish'))
          },
          resolveId: {
            order: 'pre',
            handler(id) {
              if (id === indexHtmlId)
                return id
              return null
            },
          },
          load: {
            order: 'pre',
            handler(id) {
              if (id === indexHtmlId) {
                return options.utils.indexHtml
              }
            },
          },
        },
      ],
      build: {
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
          input: {
            index: indexHtmlId,
          },
        },
      },
    } satisfies InlineConfig,
    viteConfig,
    'build',
  )

  await viteBuild(inlineConfig)

  const outDir = resolve(options.userRoot, config.build.outDir)

  if (publishFiles?.size) {
    const publishDir = resolve(outDir, '_publish')
    await fs.mkdir(publishDir, { recursive: true })
    for (const [name, bytes] of publishFiles)
      await fs.writeFile(join(publishDir, name), bytes)
  }

  // copy or generate ogImage if it's a relative path, skip if not
  if (options.data.config.seoMeta?.ogImage === 'auto' || options.data.config.seoMeta?.ogImage?.startsWith('.')) {
    const filename = options.data.config.seoMeta?.ogImage === 'auto' ? 'og-image.png' : options.data.config.seoMeta.ogImage
    const projectOgImagePath = resolve(options.userRoot, filename)
    const outputOgImagePath = resolve(outDir, filename)

    const projectOgImageExists = await fs.access(projectOgImagePath).then(() => true).catch(() => false)
    if (projectOgImageExists) {
      await fs.copyFile(projectOgImagePath, outputOgImagePath)
    }
    else if (options.data.config.seoMeta?.ogImage === 'auto') {
      const port = 12445
      const app = connect()
      const server = http.createServer(app)
      app.use(
        config.base,
        sirv(outDir, {
          etag: true,
          single: true,
          dev: true,
        }),
      )
      server.listen(port)

      const { exportSlides } = await import('./export')
      const tempDir = resolve(outDir, 'temp')
      await fs.mkdir(tempDir, { recursive: true })

      await exportSlides({
        port,
        base: config.base,
        slides: options.data.slides,
        total: options.data.slides.length,
        format: 'png',
        output: tempDir,
        range: '1',
        width: options.data.config.canvasWidth,
        height: Math.round(options.data.config.canvasWidth / options.data.config.aspectRatio),
        // This renders slides by URL, so memory routing falls back to history.
        routerMode: options.data.config.routerMode === 'memory' ? 'history' : options.data.config.routerMode,
        waitUntil: 'networkidle',
        timeout: args.timeout || 30000,
        perSlide: true,
        omitBackground: false,
        dark: args.dark,
      })

      const tempFiles = await fs.readdir(tempDir)
      const pngFile = tempFiles.find(file => file.endsWith('.png'))
      if (pngFile) {
        const generatedPath = resolve(tempDir, pngFile)
        await fs.copyFile(generatedPath, projectOgImagePath)
        await fs.copyFile(generatedPath, outputOgImagePath)
      }

      await fs.rm(tempDir, { recursive: true, force: true })
      server.close()
    }
    else {
      throw new Error(`[Slidev] ogImage: ${filename} not found`)
    }
  }

  // Copy index.html to 404.html for GitHub Pages. GH Pages serves 404.html for
  // any path it can't find on disk — for slidev that includes every deep link
  // (`/1`, `/2`, …) since the SPA doesn't pre-render per-slide HTML files. The
  // SPA bootstraps from this 404.html copy, reads `location.pathname`, and
  // routes to the right page (or to its own `404.vue` for genuinely-bad
  // paths — see `/:no(\\d+)` constraint in `setup/routes.ts`).
  await fs.copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
  // _redirects for SPA. Not for the Worker deploy target, whose `not_found_handling` does it:
  // Workers assets read `_redirects` too, and reject this catch-all as a loop.
  const { generateOgShells, resolveWorkerConfig } = await import('./og')
  const worker = options.data.config.publish?.baseUrl && resolveWorkerConfig(options.data.config.publish?.worker, args.worker)
  const redirectsPath = resolve(outDir, '_redirects')
  if (!worker && !existsSync(redirectsPath))
    await fs.writeFile(redirectsPath, `${config.base}*    ${config.base}index.html   200\n`, 'utf-8')

  // Per-slide OG shells + images. Skipped when `publish.baseUrl` isn't configured.
  // See specs/bluesky-slide-threads.md (Phase 1).
  await generateOgShells(options, args, outDir, config)

  if ([true, 'true', 'auto'].includes(options.data.config.download)) {
    const { exportSlides, getExportOptions } = await import('./export')

    const port = 12445
    const app = connect()
    const server = http.createServer(app)
    app.use(
      config.base,
      sirv(outDir, {
        etag: true,
        single: true,
        dev: true,
      }),
    )
    server.listen(port)
    const filename = options.data.config.exportFilename || 'slidev-exported'
    await exportSlides({
      port,
      base: config.base,
      ...getExportOptions(args, options, join(outDir, `${filename}.pdf`)),
    })
    server.close()
  }
}

async function readFlatDir(dir: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  if (!existsSync(dir))
    return files
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isFile())
      files.set(entry.name, await fs.readFile(join(dir, entry.name)))
  }
  return files
}
