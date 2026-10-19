import type MagicString from 'magic-string-stack'
import type MarkdownExit from 'markdown-exit'
import { SourceMapConsumer } from 'source-map-js'

type ImageRenderer = NonNullable<MarkdownExit['renderer']['rules']['image']>

export interface DraggableImageOptions {
  /**
   * Whether to make images draggable by default: `true` for markdown images, `'all'` to also
   * cover raw HTML `<img>` tags and the components in `tags`.
   * @default false
   */
  enabled?: boolean | 'all'
  /**
   * Components (by tag name, e.g. `Scrn`) whose root element is an image, treated like `<img>`
   * when `enabled` is `'all'`.
   * @default []
   */
  tags?: string[]
  /**
   * Components (by tag name) that get their own drag / resize box: `v-drag.flow.autoheight`, so
   * they keep their layout slot and their height follows their content as their width changes.
   * Independent of `enabled`.
   * @default []
   */
  components?: string[]
}

/**
 * Extract a stable ID from an image source path/URL.
 * E.g., `/images/mario.png` → `mario`, `https://example.com/cat.jpg?v=2` → `cat`
 */
export function extractImageId(src: string): string {
  // Remove query string and hash
  const cleanSrc = src.split(/[?#]/)[0]
  // Get basename (last path segment)
  const basename = cleanSrc.split('/').pop() || ''
  // Remove extension
  const name = basename.replace(/\.[^.]+$/, '')
  // Sanitize: keep only alphanumeric, dash, underscore; replace others with dash
  const sanitized = name.replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  // Return sanitized name or fallback
  return sanitized || 'img'
}

/**
 * Markdown-it plugin to make images draggable by default.
 * Transforms `![alt](src)` to `<img v-drag="'img-NAME'" src="..." alt="...">` where NAME is derived from the image basename.
 */
export default function MarkdownItDraggableImage(
  md: MarkdownExit,
  markdownTransformMap: Map<string, MagicString>,
  pluginOptions: DraggableImageOptions = {},
) {
  const components = pluginOptions.components ?? []
  if (!pluginOptions.enabled && !components.length)
    return

  const sourceMapConsumers = new WeakMap<MagicString, SourceMapConsumer>()

  function getSourceMapConsumer(id: string) {
    const s = markdownTransformMap.get(id)
    if (!s)
      return undefined
    let smc = sourceMapConsumers.get(s)
    if (smc)
      return smc
    const sourceMap = s.generateMap()
    smc = new SourceMapConsumer({
      ...sourceMap,
      version: sourceMap.version.toString(),
      sourcesContent: sourceMap.sourcesContent?.map(content => content ?? ''),
    })
    sourceMapConsumers.set(s, smc)
    return smc
  }

  // Per-slide id allocation, shared by markdown images, HTML tags and components so ids stay unique.
  function allocateId(env: any, baseId: string): string {
    const slideNo = env.slideNo ?? 1
    env._draggableImageIds = env._draggableImageIds ?? new Map<number, Set<string>>()
    const slideIds: Set<string> = env._draggableImageIds.get(slideNo) ?? new Set()
    env._draggableImageIds.set(slideNo, slideIds)
    let imgId = baseId
    let counter = 2
    while (slideIds.has(imgId))
      imgId = `${baseId}-${counter++}`
    slideIds.add(imgId)
    return imgId
  }

  const images = pluginOptions.enabled === 'all' ? ['img', ...pluginOptions.tags ?? []] : []
  if (images.length || components.length) {
    for (const rule of ['html_block', 'html_inline'] as const) {
      const defaultHtmlRender = md.renderer.rules[rule]
        ?? ((tokens, idx) => tokens[idx].content)
      md.renderer.rules[rule] = function (tokens, idx, opts, env, self) {
        let html = defaultHtmlRender(tokens, idx, opts, env, self) as string
        if (images.length)
          html = addVDrag(html, images, 'v-drag.flow', attrs => allocateId(env, `img-${extractImageId(srcOf(attrs))}`))
        if (components.length)
          html = addVDrag(html, components, 'v-drag.flow.autoheight', (_, tag) => allocateId(env, `cmp-${kebab(tag)}`))
        return html
      }
    }
  }

  if (!pluginOptions.enabled)
    return

  const defaultImageRender: ImageRenderer = md.renderer.rules.image
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx]

    // Check if this image already has v-drag (from explicit markup)
    // If parent tokens include v-drag, skip
    const existingAttrs = token.attrs?.map(a => a[0]) ?? []
    if (existingAttrs.some(attr => attr.includes('v-drag')))
      return defaultImageRender(tokens, idx, options, env, self)

    // Get image attributes
    const src = token.attrGet('src') ?? ''
    const alt = token.attrGet('alt') ?? token.content ?? ''
    const title = token.attrGet('title')

    // Generate a stable ID for this image based on its source basename, unique within the slide
    const imgId = allocateId(env, `img-${extractImageId(src)}`)

    // Calculate markdown source position for persistence
    const smc = getSourceMapConsumer(env.id)
    const toOriginalPos = smc
      ? (line: number) => smc.originalPositionFor({ line: line + 1, column: 0 }).line - 1
      : (line: number) => line

    let markdownSource = ''
    if (token.map) {
      const start = toOriginalPos(token.map[0])
      const end = toOriginalPos(token.map[1])
      markdownSource = ` :markdownSource="[${start},${Math.max(start + 1, end)},${idx}]"`
    }

    // Build the img tag with v-drag
    // Under `'all'`, markdown images keep their layout slot too (`.flow`), like HTML ones; `true`
    // keeps the original take-it-out-of-the-layout behavior.
    const directive = pluginOptions.enabled === 'all' ? 'v-drag.flow' : 'v-drag'
    let imgTag = `<img ${directive}="'${imgId}'"${markdownSource} src="${src}" alt="${alt}"`
    if (title)
      imgTag += ` title="${title}"`
    imgTag += ` />`

    return imgTag
  }
}

function srcOf(attrs: string): string {
  return attrs.match(/(?:^|\s):?src\s*=\s*(["'])(.*?)\1/)?.[2] ?? ''
}

function kebab(tag: string): string {
  return tag.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Add `directive="'<id>'"` to each opening tag named in `tags` in a chunk of raw HTML that doesn't
 * already have a `v-drag`. Quoted attribute values may contain `>` (e.g. `:fn="x => x"`).
 */
export function addVDrag(html: string, tags: string[], directive: string, allocateId: (attrs: string, tag: string) => string): string {
  const names = tags.map(t => t.replace(/[^\w-]/g, ''))
  const re = new RegExp(`<(${names.join('|')})(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g')
  return html.replace(re, (match, tag: string, attrs: string) => {
    if (/(?:^|\s)v-drag\b/.test(attrs))
      return match
    return `<${tag} ${directive}="'${allocateId(attrs, tag)}'"${attrs}>`
  })
}

/**
 * Add `v-drag.flow="'img-<name>'"` to each `<img>` (and each listed component) in a chunk of raw
 * HTML that doesn't already have a `v-drag`. `flow` because hand-written HTML images sit in
 * author-built layouts (grids, columns), which absolute positioning would break.
 */
export function addVDragToHtmlImages(html: string, tags: string[], allocateId: (src: string) => string): string {
  return addVDrag(html, ['img', ...tags], 'v-drag.flow', attrs => allocateId(srcOf(attrs)))
}
