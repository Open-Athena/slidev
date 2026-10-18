import type MagicString from 'magic-string-stack'
import type MarkdownExit from 'markdown-exit'
import { SourceMapConsumer } from 'source-map-js'

/**
 * Attribute carrying a block's source line range (`start,end`, end-exclusive) within the slide's
 * markdown content, the same coordinates `/__slidev/slides/<n>.json` serves. In-app text editing
 * uses it to write an edited block back to the right lines.
 */
export const SOURCE_LINES_ATTR = 'data-slidev-md'
/** On table cells: the cell's index within its row (whose line is in `SOURCE_LINES_ATTR`). */
export const SOURCE_CELL_ATTR = 'data-slidev-md-cell'

/**
 * Tag editable text blocks (headings, paragraphs, list items, table cells) with their source
 * lines. Only enabled in dev with the editor feature on; builds render unchanged.
 */
export default function MarkdownItSourceLines(md: MarkdownExit, markdownTransformMap: Map<string, MagicString>) {
  const sourceMapConsumers = new WeakMap<MagicString, SourceMapConsumer>()

  function getSourceMapConsumer(id: string | undefined) {
    const s = id && markdownTransformMap.get(id)
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

  md.core.ruler.push('slidev_source_lines', (state) => {
    const smc = getSourceMapConsumer(state.env?.id)
    const toOriginal = smc
      ? (line: number) => smc.originalPositionFor({ line: line + 1, column: 0 }).line - 1
      : (line: number) => line
    const range = (map: [number, number]) => {
      const start = toOriginal(map[0])
      const end = toOriginal(map[1] - 1) + 1
      return start >= 0 && end > start ? `${start},${end}` : null
    }

    const tokens = state.tokens
    let rowRange: string | null = null
    let cellIndex = 0
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      switch (token.type) {
        case 'heading_open':
        case 'paragraph_open': {
          // Hidden paragraphs (tight list items) render no tag; their list item carries the range.
          if (token.hidden || !token.map)
            break
          const r = range(token.map)
          if (r)
            token.attrSet(SOURCE_LINES_ATTR, r)
          break
        }
        case 'list_item_open': {
          // The item's own text is its first paragraph; nested lists inside the item aren't part of it.
          const paragraph = tokens[i + 1]
          if (paragraph?.type === 'paragraph_open' && paragraph.map) {
            const r = range(paragraph.map)
            if (r)
              token.attrSet(SOURCE_LINES_ATTR, r)
          }
          break
        }
        case 'tr_open':
          rowRange = token.map ? range(token.map) : null
          cellIndex = 0
          break
        case 'th_open':
        case 'td_open':
          if (rowRange) {
            token.attrSet(SOURCE_LINES_ATTR, rowRange)
            token.attrSet(SOURCE_CELL_ATTR, String(cellIndex))
          }
          cellIndex++
          break
      }
    }
  })
}
