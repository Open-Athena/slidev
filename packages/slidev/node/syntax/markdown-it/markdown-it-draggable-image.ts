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
 * Markdown-it plugin to make images draggable by default.
 * Transforms `![alt](src)` to `<img v-drag="'img-N'" src="..." alt="...">` where N is a unique index.
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

    // Generate a unique ID for this image based on slide + index
    // Use a hash of src to make IDs somewhat stable across edits
    const slideNo = env.slideNo ?? 1
    const imgIndex = env._draggableImageIndex = (env._draggableImageIndex ?? 0) + 1
    const imgId = `img-${slideNo}-${imgIndex}`

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
