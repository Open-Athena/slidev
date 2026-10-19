import type { CodeblockTransformer, ResolvedSlidevOptions } from '@slidev/types'
import type MagicString from 'magic-string'
import type MarkdownExit from 'markdown-exit'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import MarkdownItComark from '@comark/markdown-it'
import { taskLists as MarkdownItTaskList } from '@hedgedoc/markdown-it-plugins'
// @ts-expect-error missing types
import MarkdownItFootnote from 'markdown-it-footnote'
import MarkdownItGitHubAlerts from 'markdown-it-github-alerts'
import { parse as parseSfc } from 'vue/compiler-sfc'
import { MarkdownItCodeblocks } from './codeblock'
import MarkdownItVDrag from './drag'
import MarkdownItDraggableImage from './draggable-image'
import MarkdownItEscapeInlineCode from './escape-code'
import MarkdownItKatex from './katex'
import MarkdownItLink from './link'
import MarkdownItStyleScoped from './scoped'
import MarkdownItShiki from './shiki'
import MarkdownItSlotSugar from './slot-sugar'
import MarkdownItSnippet from './snippet'
import MarkdownItSourceLines from './source-lines'

export async function useMarkdownItPlugins(
  md: MarkdownExit,
  options: ResolvedSlidevOptions,
  markdownTransformMap: Map<string, MagicString>,
  codeblockTransformers: (CodeblockTransformer | false)[],
) {
  const { data: { features, config }, utils: { katexOptions } } = options

  md.use(MarkdownItSnippet, options)
  md.use(await MarkdownItShiki(options))
  md.use(MarkdownItCodeblocks, options, codeblockTransformers)

  md.use(MarkdownItLink)
  md.use(MarkdownItEscapeInlineCode)
  md.use(MarkdownItFootnote)
  md.use(MarkdownItTaskList, { enabled: true, lineNumber: true, label: true })
  if (features.katex)
    md.use(MarkdownItKatex, katexOptions)
  md.use(MarkdownItDraggableImage, markdownTransformMap, {
    enabled: config.draggableImages,
    tags: config.draggableImageTags,
    components: resolveDraggableComponents(config.draggableComponents, options.userRoot),
  })
  md.use(MarkdownItVDrag, markdownTransformMap)
  // Source line ranges on text blocks, for in-app text editing (dev + editor only).
  if (options.mode === 'dev' && config.editor !== false)
    md.use(MarkdownItSourceLines, markdownTransformMap)
  md.use(MarkdownItSlotSugar)
  if (config.comark || config.mdc)
    md.use(MarkdownItComark)
  md.use(MarkdownItStyleScoped)
  md.use(MarkdownItGitHubAlerts as any)
}

// `draggableComponents: true` means the deck's own components (`<userRoot>/components/*.vue`)
// whose template has a single root element: `v-drag` can't attach to a fragment (Vue warns and
// the directive does nothing), so multi-root components are left out.
export function resolveDraggableComponents(value: boolean | string[] | undefined, userRoot: string): string[] {
  if (Array.isArray(value))
    return value
  if (value !== true)
    return []
  const dir = join(userRoot, 'components')
  if (!existsSync(dir))
    return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.vue') && hasSingleRoot(readFileSync(join(dir, f), 'utf-8')))
    .map(f => f.slice(0, -'.vue'.length))
}

function hasSingleRoot(sfc: string): boolean {
  const ast = parseSfc(sfc).descriptor.template?.ast
  // Element nodes (type 1) at the top level, ignoring comments and whitespace.
  return ast?.children.filter(n => n.type === 1).length === 1
}
