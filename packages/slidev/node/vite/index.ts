import type { ResolvedSlidevOptions, SlidevPluginOptions, SlidevServerOptions } from '@slidev/types'
import type { PluginOption } from 'vite'
import process from 'node:process'
import setupVitePlugins from '../setups/vite-plugins'
import { createVueCompilerFlagsPlugin } from './compilerFlagsVue'
import { createComponentsPlugin } from './components'
import { createContextInjectionPlugin } from './contextInjection'
import { createConfigPlugin } from './extendConfig'
import { createHmrPatchPlugin } from './hmrPatch'
import { createIconsPlugin } from './icons'
import { createSlideImportGuardPlugin } from './importGuard'
import { createInspectPlugin } from './inspect'
import { createLayoutWrapperPlugin } from './layoutWrapper'
import { createSlidesLoader } from './loaders'
import { createMarkdownPlugin } from './markdown'
import { createMonacoTypesLoader } from './monacoTypes'
import { createMonacoWriterPlugin } from './monacoWrite'
import { createPatchMonacoSourceMapPlugin } from './patchMonacoSourceMap'
import { createRemoteAssetsPlugin } from './remoteAssets'
import { createServerRefPlugin } from './serverRef'
import { createStatePlugin } from './state'
import { createStaticCopyPlugin } from './staticCopy'
import { createUnocssPlugin } from './unocss'
import { createUploadPlugin } from './upload'
import { createVuePlugin } from './vue'

export function ViteSlidevPlugin(
  options: ResolvedSlidevOptions,
  pluginOptions: SlidevPluginOptions = {},
  serverOptions: SlidevServerOptions = {},
): Promise<PluginOption[]> {
  // Simulate the static-deploy environment while keeping HMR / live source watching.
  // Skips the dev-only middleware (SQLite-backed state + image upload) so the client's
  // `/__slidev/state` probe falls through, and it picks `LocalStateClient` exactly as
  // it would on a true static build. Used by `pnpm -C demo/starter static:dev` to A/B
  // the local-vs-remote state-client paths on port 3283 with HMR.
  const devStatic = process.env.SLIDEV_DEV_STATIC === '1'
  return Promise.all([
    createSlidesLoader(options, serverOptions),
    ...(devStatic ? [] : [createUploadPlugin(options), createStatePlugin(options)]),
    createMarkdownPlugin(options, pluginOptions),
    createLayoutWrapperPlugin(options),
    createContextInjectionPlugin(),
    createVuePlugin(options, pluginOptions),
    createSlideImportGuardPlugin(),
    createHmrPatchPlugin(),
    createComponentsPlugin(options, pluginOptions),
    createIconsPlugin(options, pluginOptions),
    createRemoteAssetsPlugin(options, pluginOptions),
    createServerRefPlugin(options, pluginOptions),
    createConfigPlugin(options),
    createMonacoTypesLoader(options),
    createMonacoWriterPlugin(options),
    createVueCompilerFlagsPlugin(options),
    createUnocssPlugin(options, pluginOptions),
    createStaticCopyPlugin(options, pluginOptions),
    createInspectPlugin(options, pluginOptions),
    createPatchMonacoSourceMapPlugin(),

    setupVitePlugins(options),
  ])
}
