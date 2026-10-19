// Pure helpers for copying / pasting draggable elements (`useCopyPaste.ts`): the element's own
// markdown within its source lines, an id for the copy, and its offset position. Tested in
// `test/element-copy.test.ts`.

export interface CopiedElement {
  /** The element's markdown: `![](…)`, `<img …>`, `<Tag …/>`, or its whole lines as a fallback. */
  snippet: string
  dragId: string
  /** The original's position string (`Left,Top,Width,Height[,Rotate,ZIndex,Crop…]`). */
  pos: string | null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The element's own markdown within its source lines: a markdown or HTML image with its `src`,
 * or a tag carrying its explicit id. Falls back to the whole lines (e.g. a multi-line component), or
 * with `wholeLines: false` (searching a whole slide) to `null`.
 */
export function elementSnippet(lines: string[], el: { src?: string | null, dragId: string }): string
export function elementSnippet(lines: string[], el: { src?: string | null, dragId: string }, wholeLines: false): string | null
export function elementSnippet(lines: string[], el: { src?: string | null, dragId: string }, wholeLines = true): string | null {
  const text = lines.join('\n')
  const at = findElement(text, el)
  return at ? text.slice(at.start, at.end) : wholeLines ? text : null
}

/** Offsets of the element's own markup in `text` (see `elementSnippet`), or `null`. */
export function findElement(text: string, el: { src?: string | null, dragId: string }): { start: number, end: number } | null {
  const attrs = `(?:[^>"']|"[^"]*"|'[^']*')*`
  // Auto ids number repeats in order of appearance (`img-x`, `img-x-2`): `-2` is the 2nd match.
  const auto = el.dragId.match(/^(?:img|cmp)-.+?(?:-(\d+))?$/)
  const nth = auto?.[1] ? Number(auto[1]) - 1 : 0
  const candidates: RegExp[] = []
  if (el.src) {
    const src = escapeRegex(el.src)
    candidates.push(new RegExp(`!\\[[^\\]\\n]*\\]\\(\\s*<?${src}>?(?:\\s+"[^"]*")?\\s*\\)|<img\\b${attrs}\\bsrc=(["'])${src}\\1${attrs}>`, 'g'))
  }
  const component = el.dragId.match(/^cmp-([a-z\d-]+?)(?:-\d+)?$/)?.[1]
  if (component) {
    const tag = component.replace(/(?:^|-)([a-z\d])/g, (_, c: string) => c.toUpperCase())
    candidates.push(new RegExp(`<${tag}\\b${attrs}/>|<${tag}\\b${attrs}>[\\s\\S]*?</${tag}>`, 'g'))
  }
  candidates.push(new RegExp(`<([A-Za-z][\\w-]*)\\b${attrs}(["'])${escapeRegex(el.dragId)}\\2${attrs}/>`, 'g'))
  for (const re of candidates) {
    const matches = [...text.matchAll(re)]
    const m = matches[Math.min(nth, matches.length - 1)]
    if (m)
      return { start: m.index!, end: m.index! + m[0].length }
  }
  return null
}

/** Remove the markup at `[start, end)`; a line left blank goes too (with one blank line kept between blocks). */
export function removeRange(text: string, start: number, end: number): string {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  const lineEnd = nl < 0 ? text.length : nl
  const rest = text.slice(lineStart, start) + text.slice(end, lineEnd)
  if (rest.trim())
    return text.slice(0, start) + text.slice(end)
  // Drop the whole line, and collapse the blank lines around it to one.
  const before = text.slice(0, lineStart).replace(/\n\s*$/, '\n')
  const after = text.slice(Math.min(text.length, lineEnd + 1)).replace(/^\s*\n/, '')
  // At the end of the slide, end without trailing blank lines, as the server stores slides.
  return before && after ? `${before}\n${after}` : after ? before + after : before.replace(/\s+$/, '')
}

/** An id not in `taken`: `id-copy`, `id-copy-2`, … */
export function uniqueId(id: string, taken: Set<string>): string {
  const base = `${id.replace(/-copy(?:-\d+)?$/, '')}-copy`
  let next = base
  for (let n = 2; taken.has(next); n++)
    next = `${base}-${n}`
  return next
}

/**
 * Give the copy its own id: an explicit one in the snippet (`v-drag="'box'"`, `pos="box"`) is
 * renamed; otherwise the id is auto-assigned in order of appearance (`img-x`, `img-x-2`, …), and
 * the copy, appended at the end of the slide, gets the next in that sequence.
 */
export function idForCopy(snippet: string, dragId: string, slideIds: string[]): { snippet: string, dragId: string } {
  const quoted = new RegExp(`((?:v-drag[\\w.]*|pos)=["']'?)${escapeRegex(dragId)}('?["'])`)
  if (quoted.test(snippet)) {
    const next = uniqueId(dragId, new Set(slideIds))
    return { snippet: snippet.replace(quoted, `$1${next}$2`), dragId: next }
  }
  const base = autoBaseId(snippet) ?? dragId.replace(/-\d+$/, '')
  const same = slideIds.filter(id => id === base || new RegExp(`^${escapeRegex(base)}-\\d+$`).test(id)).length
  return { snippet, dragId: same ? `${base}-${same + 1}` : base }
}

// Mirrors `extractImageId` in `node/syntax/draggable-image.ts`.
function imageId(src: string): string {
  const name = (src.split(/[?#]/)[0].split('/').pop() || '').replace(/\.[^.]+$/, '')
  return name.replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'img'
}

/**
 * The un-numbered auto id the markdown plugin gives the snippet's element (`img-<basename>`,
 * `cmp-<kebab-tag>`). Derived from the markup, since a basename can itself end in digits
 * (`shot-0813`), which the id alone can't tell from a repeat counter.
 */
export function autoBaseId(snippet: string): string | null {
  const src = snippet.match(/^!\[[^\]]*\]\(\s*<?([^\s)>]+)/)?.[1] ?? snippet.match(/^<img\s(?:[^>]*\s)?src=(["'])(.*?)\1/)?.[2]
  if (src)
    return `img-${imageId(src)}`
  const tag = snippet.match(/^<([A-Z][\w-]*)/)?.[1]
  return tag ? `cmp-${tag.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase()}` : null
}

/** Shift a position string's left / top by `dx` / `dy`, keeping the rest. */
export function offsetPos(pos: string, dx: number, dy: number): string {
  const parts = pos.split(',')
  parts[0] = String(Math.round(Number(parts[0]) + dx))
  parts[1] = String(Math.round(Number(parts[1]) + dy))
  return parts.join(',')
}

/** Append a snippet to the end of a slide's markdown, as its own block (no trailing newline, as the server stores slides). */
export function appendSnippet(content: string, snippet: string): string {
  const trimmed = content.replace(/\s+$/, '')
  return `${trimmed}${trimmed ? '\n\n' : ''}${snippet}`
}

/** A position string as an element snapshot (center-based; `_` / `NaN` height stays `NaN`). */
export function posToSnapshot(pos: string): { x0: number, y0: number, width: number, height: number, rotate: number, zIndex: number, cropTop: number, cropRight: number, cropBottom: number, cropLeft: number } {
  const [l, t, w, h, r = 0, z = 100, ct = 0, cr = 0, cb = 0, cl = 0] = pos.split(',').map(v => v === '_' ? Number.NaN : Number(v))
  return { x0: l + w / 2, y0: t + (Number.isFinite(h) ? h : 0) / 2, width: w, height: h, rotate: r, zIndex: z, cropTop: ct, cropRight: cr, cropBottom: cb, cropLeft: cl }
}
