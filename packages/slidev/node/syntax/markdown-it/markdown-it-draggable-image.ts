import type MagicString from 'magic-string-stack'
import type MarkdownIt from 'markdown-it'
import { SourceMapConsumer } from 'source-map-js'

export interface DraggableImageOptions {
  /**
   * Whether to make images draggable by default
   * @default false
   */
  enabled?: boolean
}

/**
 * Extract a stable ID from an image source path/URL.
 * E.g., `/images/mario.png` → `mario`, `https://example.com/cat.jpg?v=2` → `cat`
 */
function extractImageId(src: string): string {
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
  md: MarkdownIt,
  markdownTransformMap: Map<string, MagicString>,
  options: DraggableImageOptions = {},
) {
  if (!options.enabled)
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
    })
    sourceMapConsumers.set(s, smc)
    return smc
  }

  const defaultImageRender = md.renderer.rules.image
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

    // Generate a stable ID for this image based on its source basename
    // Track used IDs per slide to handle duplicates
    const slideNo = env.slideNo ?? 1
    env._draggableImageIds = env._draggableImageIds ?? new Map<number, Set<string>>()
    const slideIds: Set<string> = env._draggableImageIds.get(slideNo) ?? new Set()
    env._draggableImageIds.set(slideNo, slideIds)

    // Extract base ID from src and ensure uniqueness within slide
    const baseId = `img-${extractImageId(src)}`
    let imgId = baseId
    let counter = 2
    while (slideIds.has(imgId)) {
      imgId = `${baseId}-${counter++}`
    }
    slideIds.add(imgId)

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
    let imgTag = `<img v-drag="'${imgId}'"${markdownSource} src="${src}" alt="${alt}"`
    if (title)
      imgTag += ` title="${title}"`
    imgTag += ` />`

    return imgTag
  }
}
