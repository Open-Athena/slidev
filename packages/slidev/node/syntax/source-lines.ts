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
 * On block-level HTML tags written in the slide's markdown: `<line>:<k>`, the tag being the k-th
 * such tag starting on that source line. Column resizing uses it to rewrite a grid's inline style.
 */
export const SOURCE_HTML_ATTR = 'data-slidev-html'

/** Mirrors `OPEN_TAG_RE` in `client/composables/grid-cols.ts`; comments are matched to skip them. */
const HTML_TAG_RE = /<!--[\s\S]*?-->|<(div|section|article|aside|figure|main|header|footer|nav|ul|ol)(?=[\s>/])/gi

/** Tag each block-level opening tag in an HTML block with its source position. */
export function tagHtmlBlock(content: string, lineOf: (offsetLine: number) => number): string {
  let out = ''
  let last = 0
  let offsetLine = 0
  let scanned = 0
  let line = -1
  let k = 0
  for (const m of content.matchAll(HTML_TAG_RE)) {
    if (!m[1])
      continue
    for (; scanned < m.index; scanned++) {
      if (content[scanned] === '\n')
        offsetLine++
    }
    const l = lineOf(offsetLine)
    if (l < 0)
      continue
    k = l === line ? k + 1 : 0
    line = l
    const at = m.index + m[0].length
    out += `${content.slice(last, at)} ${SOURCE_HTML_ATTR}="${l}:${k}"`
    last = at
  }
  return out + content.slice(last)
}

/**
 * Tag editable text blocks (headings, paragraphs, list items, table cells) with their source
 * lines, and block-level HTML tags with their source position. Only enabled in dev with the editor feature on; builds render unchanged.
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
        case 'html_block':
          if (token.map) {
            const start = token.map[0]
            token.content = tagHtmlBlock(token.content, offsetLine => toOriginal(start + offsetLine))
          }
          break
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
