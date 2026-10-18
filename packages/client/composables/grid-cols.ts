// Pure helpers for resizing grid columns in edit mode: reading track widths, formatting new
// splits for the slide's frontmatter (`cols: 40/60`) or an HTML block's inline style, and
// rewriting that style in the slide's markdown. Kept free of Vue / vite virtuals so it's
// unit-testable (see `test/grid-cols.test.ts`).

/** Mirrors `SOURCE_HTML_ATTR` in `node/syntax/source-lines.ts`: `<line>:<k>` = the k-th tag on that line. */
export const HTML_ATTR = 'data-slidev-html'
/** Theme layouts mark the grid whose columns come from the slide's `cols` frontmatter with this. */
export const LAYOUT_COLS_ATTR = 'data-slidev-cols'

/** Opening tags `source-lines.ts` tags with their position; mirrors `HTML_TAG_RE` there. */
const OPEN_TAG_RE = /<!--[\s\S]*?-->|<(div|section|article|aside|figure|main|header|footer|nav|ul|ol)(?=[\s>/])/gi

export interface HtmlTagRef {
  line: number
  index: number
}

export function parseHtmlTagRef(value: string | null | undefined): HtmlTagRef | null {
  const m = value?.match(/^(\d+):(\d+)$/)
  return m ? { line: Number(m[1]), index: Number(m[2]) } : null
}

/** Track sizes from a computed `grid-template-columns` (`"312px 408.5px"`); `null` if any isn't px. */
export function parseComputedTracks(template: string): number[] | null {
  const parts = template.trim().split(/\s+/)
  const px = parts.map(p => p.match(/^(-?[\d.]+)px$/)?.[1])
  if (parts.length < 2 || px.some(p => p == null))
    return null
  return px.map(Number)
}

/**
 * Whether an authored `grid-template-columns` value is all flexible tracks (`1fr 1.45fr`,
 * `repeat(3, 1fr)`, `repeat(2, minmax(0, 1fr))`), i.e. a split a drag can rewrite without
 * losing fixed or `auto` tracks.
 */
const FLEX_TRACK_RE = /^(?:[\d.]+fr|minmax\(0(?:px)?,[\d.]+fr\)|repeat\(\d+,(?:[\d.]+fr|minmax\(0(?:px)?,[\d.]+fr\))\))$/

export function isFlexibleTemplate(value: string): boolean {
  const tokens = value.trim().replace(/\s*([(),])\s*/g, '$1').split(/\s+/)
  return tokens.every(t => FLEX_TRACK_RE.test(t))
}

function round2(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Track widths as `fr`s, the narrowest at `1fr` (`[300, 435] → "1fr 1.45fr"`). */
export function formatFr(widths: number[]): string {
  const min = Math.min(...widths)
  return widths.map(w => `${round2(w / min)}fr`).join(' ')
}

/** Track widths as whole percents summing to 100 (`[2, 3] → "40/60"`), for the `cols` frontmatter. */
export function formatPercent(widths: number[]): string {
  const total = widths.reduce((a, b) => a + b, 0)
  const exact = widths.map(w => w / total * 100)
  const floors = exact.map(Math.floor)
  // Largest remainder: hand the leftover points to the tracks that lost the most to flooring.
  let left = 100 - floors.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => [e - floors[i], i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left-- <= 0)
      break
    floors[i]++
  }
  return floors.join('/')
}

/** A slide's `cols` frontmatter (`40/60`, `[2, 3]`) as a `grid-template-columns` value. */
export function colsToTemplate(cols: unknown): string | undefined {
  const parts = Array.isArray(cols)
    ? cols.map(Number)
    : typeof cols === 'string'
      ? cols.split('/').map(s => Number(s.trim()))
      : []
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n) || n <= 0))
    return undefined
  return parts.map(n => `${n}fr`).join(' ')
}

/**
 * Move the boundary between tracks `i` and `i + 1` by `delta` (px), keeping their sum and
 * holding each at `min` or wider.
 */
export function resizePair(widths: number[], i: number, delta: number, min: number): number[] {
  const pair = widths[i] + widths[i + 1]
  const left = Math.min(Math.max(widths[i] + delta, min), pair - min)
  const next = [...widths]
  next[i] = left
  next[i + 1] = pair - left
  return next
}

export const SNAP_RATIOS: Array<[ratio: number, label: string]> = [
  [1 / 3, '⅓'],
  [0.382, 'φ'],
  [1 / 2, '½'],
  [0.618, 'φ'],
  [2 / 3, '⅔'],
]

/**
 * Snap the left track of a pair to a common ratio of the pair's width when within `threshold`
 * px of one. Returns the (possibly unchanged) left width and the ratio's label, if it snapped.
 */
export function snapPair(left: number, pair: number, threshold: number): { left: number, label: string | null } {
  let best: { left: number, label: string } | null = null
  for (const [ratio, label] of SNAP_RATIOS) {
    const target = ratio * pair
    if (Math.abs(target - left) <= threshold && (!best || Math.abs(target - left) < Math.abs(best.left - left)))
      best = { left: target, label }
  }
  return best ?? { left, label: null }
}

/** Offsets of the opening tag `ref` points at, from `<` through its closing `>`. */
export function findOpeningTag(content: string, ref: HtmlTagRef): { start: number, end: number } | null {
  const lines = content.split('\n')
  if (ref.line >= lines.length)
    return null
  const lineStart = lines.slice(0, ref.line).reduce((n, l) => n + l.length + 1, 0)
  const lineEnd = lineStart + lines[ref.line].length
  OPEN_TAG_RE.lastIndex = lineStart
  let k = 0
  for (let m = OPEN_TAG_RE.exec(content); m && m.index < lineEnd; m = OPEN_TAG_RE.exec(content)) {
    if (!m[1])
      continue
    if (k++ !== ref.index)
      continue
    // The tag ends at the first `>` outside a quoted attribute value.
    let quote: string | null = null
    for (let i = m.index + m[0].length; i < content.length; i++) {
      const ch = content[i]
      if (quote) {
        if (ch === quote)
          quote = null
      }
      else if (ch === '"' || ch === '\'') {
        quote = ch
      }
      else if (ch === '>') {
        return { start: m.index, end: i + 1 }
      }
    }
    return null
  }
  return null
}

/** The `grid-template-columns` an opening tag's inline style sets, if any. */
export function tagGridColumns(tag: string): string | null {
  const style = tag.match(/\sstyle=(["'])(.*?)\1/s)?.[2]
  return style?.match(/(?:^|;)\s*grid-template-columns\s*:([^;]+)/i)?.[1].trim() ?? null
}

/** Set `grid-template-columns` in an opening tag's inline style, adding the style if needed. */
export function setTagGridColumns(tag: string, value: string): string {
  const style = tag.match(/\sstyle=(["'])(.*?)\1/s)
  if (!style) {
    const close = tag.endsWith('/>') ? tag.length - 2 : tag.length - 1
    const before = tag.slice(0, close).replace(/\s+$/, '')
    return `${before} style="grid-template-columns: ${value}"${tag.slice(close)}`
  }
  const [whole, q, body] = style
  const re = /((?:^|;)\s*grid-template-columns\s*:)[^;]+/i
  const nextBody = re.test(body)
    ? body.replace(re, (_, lead: string) => `${lead} ${value}`)
    : `${body.replace(/;?\s*$/, '')}${body.trim() ? '; ' : ''}grid-template-columns: ${value}`
  return tag.replace(whole, ` style=${q}${nextBody}${q}`)
}
