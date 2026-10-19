import type { ResolvedSlidevOptions, ResolvedSlidevUtils, SlidevData, SlidevEntryOptions } from '@slidev/types'
import process from 'node:process'
import { objectMap, uniq } from '@antfu/utils'
import fg from 'fast-glob'
import { createDebug } from 'obug'
import path from 'pathe'
import pm from 'picomatch'
import { applyCoords, loadCoords } from './coords'
import { resolveAddons } from './integrations/addons'
import { getThemeMeta, resolveTheme } from './integrations/themes'
import { parser } from './parser'
import { getRoots, resolveEntry, toAtFS } from './resolver'
import setupIndexHtml from './setups/indexHtml'
import setupKatex from './setups/katex'
import setupShiki from './setups/shiki'
import { applySlugHistory, loadSlugHistory } from './slug-history'
import { resolveWorkerConfig } from './worker-config'

const RE_FILE_EXTENSION = /\.\w+$/

const debug = createDebug('slidev:options')

export async function resolveOptions(
  entryOptions: SlidevEntryOptions,
  mode: ResolvedSlidevOptions['mode'],
): Promise<ResolvedSlidevOptions> {
  const entry = await resolveEntry(entryOptions.entry)
  const rootsInfo = await getRoots(entry)
  const initialLoaded = await parser.load(
    {
      userRoot: rootsInfo.userRoot,
      roots: [rootsInfo.userRoot],
      allowedRoots: uniq([rootsInfo.userWorkspaceRoot, rootsInfo.userRoot]),
    },
    entry,
    undefined,
    mode,
  )

  // Load theme data first, because it may affect the config
  let themeRaw = entryOptions.theme || initialLoaded.headmatter.theme as string | null | undefined
  themeRaw = themeRaw === null ? 'none' : (themeRaw || 'default')
  const [theme, themeRoot] = await resolveTheme(themeRaw, entry)
  const themeRoots = themeRoot ? [themeRoot] : []
  const themeMeta = themeRoot ? await getThemeMeta(theme, themeRoot) : undefined

  const initialConfig = parser.resolveConfig(initialLoaded.headmatter, themeMeta, entryOptions.entry)
  const addonRoots = await resolveAddons(initialConfig.addons)
  const roots = uniq([...themeRoots, ...addonRoots, rootsInfo.userRoot])
  const loaded = await parser.load(
    {
      userRoot: rootsInfo.userRoot,
      roots,
      allowedRoots: uniq([rootsInfo.userWorkspaceRoot, ...roots]),
    },
    entry,
    undefined,
    mode,
  )
  const config = parser.resolveConfig(loaded.headmatter, themeMeta, entryOptions.entry)

  // These fields selected the roots used for the final load. Keep the
  // returned config aligned with the graph that was actually loaded if a
  // preparser changes them.
  config.theme = themeRaw
  config.addons = initialConfig.addons

  if (entryOptions.download)
    config.download ||= entryOptions.download

  if (entryOptions.routerMode)
    config.routerMode = entryOptions.routerMode

  debug({
    ...rootsInfo,
    ...entryOptions,
    config,
    mode,
    entry,
    themeRaw,
    theme,
    themeRoots,
    addonRoots,
    roots,
  })

  const data: SlidevData = {
    ...loaded,
    config,
    themeMeta,
  }

  // Merge external drag coords (slides.coords.yaml) into per-slide frontmatter.dragPos.
  // The coords file wins over inline dragPos; new writes go to the coords file (see loaders.ts).
  // The dev server is the sole writer of this file — external edits require a server restart
  // for v1; intentionally not added to data.watchFiles to avoid an HMR loop on our own writes.
  const coords = await loadCoords(rootsInfo.userRoot)
  applyCoords(data, coords)
  // Old slugs (slides.slugs.yaml) as each slide's `slugHistory`, so old links keep resolving.
  applySlugHistory(data, await loadSlugHistory(rootsInfo.userRoot))

  const resolved: Omit<ResolvedSlidevOptions, 'utils'> = {
    ...rootsInfo,
    ...entryOptions,
    data,
    mode,
    entry,
    themeRaw,
    theme,
    themeRoots,
    addonRoots,
    roots,
  }

  return {
    ...resolved,
    utils: await createDataUtils(resolved),
  }
}

export async function createDataUtils(resolved: Omit<ResolvedSlidevOptions, 'utils'>): Promise<ResolvedSlidevUtils> {
  const monacoTypesIgnorePackagesMatches = (resolved.data.config.monacoTypesIgnorePackages || [])
    .map(i => pm.makeRe(i))

  let _layouts_cache_time = 0
  let _layouts_cache: Promise<Record<string, string>> | null = null

  return {
    ...await setupShiki(resolved.roots),
    katexOptions: await setupKatex(resolved.roots),
    indexHtml: await setupIndexHtml(resolved),
    define: getDefine(resolved),
    iconsResolvePath: [resolved.clientRoot, ...resolved.roots].reverse(),
    isMonacoTypesIgnored: pkg => monacoTypesIgnorePackagesMatches.some(i => i.test(pkg)),
    getLayouts: () => {
      const now = Date.now()
      if (_layouts_cache && now - _layouts_cache_time < 2000)
        return _layouts_cache
      _layouts_cache_time = now
      return _layouts_cache = worker()

      async function worker() {
        const layouts: Record<string, string> = {}
        const layoutPaths = await Promise.all(
          [resolved.clientRoot, ...resolved.roots]
            .map(root => fg('layouts/**/*.{vue,js,mjs,ts,mts}', {
              cwd: root,
              absolute: true,
              suppressErrors: true,
            })),
        )
        for (const layoutPath of layoutPaths.flat(1)) {
          const layoutName = path.basename(layoutPath).replace(RE_FILE_EXTENSION, '')
          layouts[layoutName] = layoutPath
        }
        return layouts
      }
    },
  }
}

/**
 * The scope of the deck's `@open-athena/auth` gate (`publish.worker.auth`, `slidev build --auth`),
 * or `''` without one. Decides whether the client asks `api/auth/whoami` at all (for "Get link").
 * `SLIDEV_AUTH_UI=1` turns it on in the dev server without a gate (the e2e fixture, whose auth
 * routes are stubbed); the dev server has no auth routes of its own, so nobody is an admin there.
 */
export function authScopeFor(options: Pick<ResolvedSlidevOptions, 'mode' | 'worker' | 'auth'> & { data: { config: { publish?: any } } }): string {
  let scope = ''
  try {
    scope = resolveWorkerConfig(options.data.config.publish?.worker, options.worker, options.auth)?.auth?.scope ?? ''
  }
  catch {
    // An unknown provider: the build refuses it (`generateOgShells`), the dev server shows nothing.
  }
  if (!scope && options.mode === 'dev' && process.env.SLIDEV_AUTH_UI === '1')
    scope = 'deck'
  return scope
}

function getDefine(options: Omit<ResolvedSlidevOptions, 'utils'>): Record<string, string> {
  const matchMode = (mode: string | boolean) => mode === true || mode === options.mode
  const authScope = authScopeFor(options)
  return objectMap(
    {
      __DEV__: options.mode === 'dev',
      __SLIDEV_CLIENT_ROOT__: toAtFS(options.clientRoot),
      __SLIDEV_HASH_ROUTE__: options.data.config.routerMode === 'hash',
      // Export navigates by URL, so memory routing (which ignores the URL) is
      // disabled during export and falls back to history.
      __SLIDEV_MEMORY_ROUTE__: options.data.config.routerMode === 'memory' && options.mode !== 'export',
      __SLIDEV_FEATURE_DRAWINGS__: matchMode(options.data.config.drawings.enabled),
      __SLIDEV_FEATURE_EDITOR__: options.mode === 'dev' && options.data.config.editor !== false,
      __SLIDEV_FEATURE_DRAWINGS_PERSIST__: !!options.data.config.drawings.persist,
      __SLIDEV_FEATURE_RECORD__: matchMode(options.data.config.record),
      __SLIDEV_FEATURE_PRESENTER__: matchMode(options.data.config.presenter),
      __SLIDEV_FEATURE_PRINT__: options.mode === 'export' || (options.mode === 'build' && [true, 'true', 'auto'].includes(options.data.config.download)),
      __SLIDEV_FEATURE_BROWSER_EXPORTER__: matchMode(options.data.config.browserExporter),
      __SLIDEV_FEATURE_WAKE_LOCK__: matchMode(options.data.config.wakeLock),
      __SLIDEV_FEATURE_PWA__: matchMode(options.data.config.pwa),
      __SLIDEV_HAS_SERVER__: options.mode !== 'build',
      __SLIDEV_FEATURE_AUTH__: !!authScope,
      __SLIDEV_AUTH_SCOPE__: authScope,
    },
    (v, k) => [v, JSON.stringify(k)],
  )
}
