// Pure helpers for in-app text editing: mapping a rendered block back to its markdown source
// lines, serializing edited inline DOM back to markdown, and splicing the result into the slide.
// Kept free of Vue / vite virtuals so it's unit-testable (see `test/text-edit.test.ts`).

/** Mirrors `SOURCE_LINES_ATTR` / `SOURCE_CELL_ATTR` in `node/syntax/source-lines.ts`. */
export const MD_ATTR = 'data-slidev-md'
export const MD_CELL_ATTR = 'data-slidev-md-cell'

export type LineRange = [start: number, end: number]

export function parseLineRange(value: string | null | undefined): LineRange | null {
  const m = value?.match(/^(\d+),(\d+)$/)
  if (!m)
    return null
  const range: LineRange = [Number(m[1]), Number(m[2])]
  return range[1] > range[0] ? range : null
}

// Block markers before a line's text: blockquote `>`s, a list marker (+ task checkbox), or an
// ATX heading's `#`s.
const PREFIX_RE = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d+[.)])(?:[ \t]+|$)(?:\[[ x]\](?:[ \t]+|$))?)?(?:#{1,6}(?:[ \t]+|$))?/i
// What precedes a continuation line's text: blockquote `>`s and indentation.
const CONTINUATION_RE = /^[ \t]*(?:>[ \t]?)*[ \t]*/
const SETEXT_UNDERLINE_RE = /^[ \t]*(?:=+|-+)[ \t]*$/

export function splitPrefix(line: string): { prefix: string, text: string } {
  const prefix = line.match(PREFIX_RE)![0]
  return { prefix, text: line.slice(prefix.length) }
}

interface BlockLines {
  lines: string[]
  /** Lines holding the block's text (a setext heading's underline excluded). */
  textEnd: number
  heading: boolean
}

function blockLines(content: string, [start, end]: LineRange): BlockLines {
  const lines = content.split('\n')
  if (end > lines.length)
    throw new Error(`Line range ${start},${end} is outside the slide (${lines.length} lines)`)
  const setext = end - start >= 2 && SETEXT_UNDERLINE_RE.test(lines[end - 1])
  const heading = setext || /^[ \t]*(?:(?:>[ \t]?)+[ \t]*)?#{1,6}(?:[ \t]|$)/.test(lines[start])
  return { lines, textEnd: setext ? end - 1 : end, heading }
}

/** A block's text as written in source: markers stripped, soft line breaks kept as `\n`. */
export function blockSourceText(content: string, range: LineRange): string {
  const { lines, textEnd } = blockLines(content, range)
  const [start] = range
  return lines.slice(start, textEnd).map((line, i) => {
    const text = i === 0 ? splitPrefix(line).text : line.replace(CONTINUATION_RE, '')
    return text.replace(/[ \t]+$/, '')
  }).join('\n')
}

/** Replace a block's text, keeping its markers (and a setext underline). */
export function replaceBlockText(content: string, range: LineRange, newText: string): string {
  const { lines, textEnd, heading } = blockLines(content, range)
  const [start, end] = range
  const { prefix } = splitPrefix(lines[start])
  const textLines = (heading ? newText.replace(/\s*\n\s*/g, ' ') : newText).split('\n')
  // Continuation lines reuse the block's existing continuation prefix, else align under the text.
  const quote = prefix.match(/^[ \t]*(?:>[ \t]?)*/)![0]
  const continuation = textEnd - start >= 2
    ? lines[start + 1].match(CONTINUATION_RE)![0]
    : quote + ' '.repeat(prefix.length - quote.length)
  // A bare marker (`-` with nothing after it, as an empty item is saved) needs a space before text.
  const first = /\S$/.test(prefix) && textLines[0] ? `${prefix} ` : prefix
  const replaced = textLines.map((text, i) => (i === 0 ? first : continuation) + text)
  return [...lines.slice(0, start), ...replaced, ...lines.slice(textEnd, end), ...lines.slice(end)].join('\n')
}

/** Split a GFM table row into cells, honoring `\|` escapes and an optional outer pipe on each side. */
function splitRow(row: string): { cells: string[], lead: boolean, trail: boolean } {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '\\' && i + 1 < row.length) {
      cur += ch + row[++i]
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  const lead = cells.length > 1 && cells[0].trim() === ''
  const trail = cells.length > 1 && cells[cells.length - 1].trim() === ''
  return { cells: cells.slice(lead ? 1 : 0, trail ? -1 : undefined), lead, trail }
}

export function cellSourceText(content: string, row: number, cell: number): string {
  const line = content.split('\n')[row]
  const { cells } = splitRow(line ?? '')
  if (cell >= cells.length)
    throw new Error(`Cell ${cell} is outside row ${row} (${cells.length} cells)`)
  return cells[cell].trim()
}

export function replaceTableCell(content: string, row: number, cell: number, newText: string): string {
  const lines = content.split('\n')
  const { cells, lead, trail } = splitRow(lines[row])
  if (cell >= cells.length)
    throw new Error(`Cell ${cell} is outside row ${row} (${cells.length} cells)`)
  const indent = lines[row].match(/^[ \t]*/)![0]
  cells[cell] = ` ${newText.replace(/\s*\n\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|')} `
  // Without a leading pipe, the indent is already part of the first cell.
  lines[row] = (lead ? `${indent}|` : '') + cells.join('|') + (trail ? '|' : '')
  return lines.join('\n')
}

/** The subset of DOM `Node` the serializer reads. */
export interface InlineNode {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<InlineNode>
  getAttribute?: (name: string) => string | null
}

const TEXT_NODE = 3
const ELEMENT_NODE = 1

// Wrap `inner` in a delimiter, moving edge whitespace outside (`**a **` isn't emphasis).
function wrap(inner: string, open: string, close = open): string {
  const core = inner.trim()
  if (!core)
    return inner
  const lead = inner.slice(0, inner.length - inner.trimStart().length)
  const trail = inner.slice(inner.trimEnd().length)
  return `${lead}${open}${core}${close}${trail}`
}

/**
 * Serialize a rendered block's inline content back to markdown. Returns `null` when the block
 * holds something this can't represent (an inline component, math, an icon, …): the caller then
 * edits the raw markdown instead. Nested lists and task-list checkboxes are skipped (they belong
 * to other blocks / the line prefix).
 */
export function serializeInline(node: InlineNode): string | null {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    const s = serializeNode(child)
    if (s === null)
      return null
    out += s
  }
  return out
}

// markdown-it's typographer curls quotes and apostrophes on render; authors type them straight.
function unTypograph(s: string): string {
  return s.replace(/[\u2018\u2019]/g, '\'').replace(/[\u201C\u201D]/g, '"')
}

function serializeNode(node: InlineNode): string | null {
  if (node.nodeType === TEXT_NODE)
    return unTypograph(node.textContent ?? '')
  if (node.nodeType !== ELEMENT_NODE)
    return ''
  const name = node.nodeName.toLowerCase()
  switch (name) {
    case 'ul':
    case 'ol':
    case 'input':
      return ''
    case 'br':
      return '<br>'
    case 'code': {
      const text = node.textContent ?? ''
      const fence = text.includes('`') ? '``' : '`'
      const pad = fence === '``' ? ' ' : ''
      return `${fence}${pad}${text}${pad}${fence}`
    }
  }
  const inner = serializeInline(node)
  if (inner === null)
    return null
  switch (name) {
    case 'strong':
    case 'b':
      return wrap(inner, '**')
    case 'em':
    case 'i':
      return wrap(inner, '*')
    case 'del':
    case 's':
      return wrap(inner, '~~')
    case 'u':
      return wrap(inner, '<u>', '</u>')
    case 'a': {
      const href = node.getAttribute?.('href') ?? ''
      return inner === href ? href : `[${inner}](${href})`
    }
    // Browsers wrap edits in bare spans / font tags; markdown has no equivalent, keep the text.
    // A task-list item's text is wrapped in a `<label>` for its checkbox.
    case 'span':
    case 'font':
    case 'label':
      return inner
    default:
      return null
  }
}

/**
 * Locate `lines` in `content` (preferring the occurrence nearest `hint`) and replace them with
 * `replacement`. Used by undo / redo of text edits, which can't trust line numbers recorded
 * earlier. Returns `null` when `lines` no longer appear.
 */
export function spliceLines(content: string, lines: string[], replacement: string[], hint: number): string | null {
  const all = content.split('\n')
  let best = -1
  for (let i = 0; i + lines.length <= all.length; i++) {
    if (lines.every((line, j) => all[i + j] === line) && (best < 0 || Math.abs(i - hint) < Math.abs(best - hint)))
      best = i
  }
  if (best < 0)
    return null
  return [...all.slice(0, best), ...replacement, ...all.slice(best + lines.length)].join('\n')
}

// Letters and digits only, lowercased: compares rendered text with markdown source loosely.
const NAMED_ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return NAMED_ENTITIES[e.toLowerCase()] ?? m
  })
}

function plainKey(s: string): string {
  return decodeEntities(s)
    .replace(/\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Whether a block's rendered text plausibly comes from `source`. Guards against writing an edit
 * to the wrong lines if the source mapping is ever off: the rendered text's start must appear
 * in the source's text (or vice versa, when components render extra text).
 */
export function looksLikeSameBlock(rendered: string, source: string): boolean {
  const r = plainKey(rendered)
  const s = plainKey(source)
  if (!r || !s)
    return r === s
  const n = Math.min(16, r.length, s.length)
  return s.includes(r.slice(0, n)) || r.includes(s.slice(0, n))
}
