// Structural edits to markdown lists, for in-app text editing (`useTextEditing`): split / insert,
// remove, merge, indent / outdent and move items, rewriting only the source lines involved. Pure
// line logic, unit-tested in `test/list-edit.test.ts`.

import { replaceBlockText } from './text-edit'

// An item's first line: blockquote / indentation lead, marker, the gap after it, task box.
const ITEM_RE = /^((?:[ \t]*>[ \t]?)*[ \t]*)([-*+]|\d+[.)])([ \t]+|$)(\[[ x]\](?:[ \t]+|$))?/i
const QUOTE_RE = /^(?:[ \t]*>[ \t]?)*/

export interface ListItem {
  /** First line of the item. */
  start: number
  /** End (exclusive) of the item's own text lines (its first paragraph). */
  textEnd: number
  /** End (exclusive) of the item including nested lists / continuation lines. */
  end: number
  /** Blockquote prefix and indentation before the marker. */
  lead: string
  marker: string
  gap: string
  /** `'[ ] '` / `'[x] '`, or `''`. */
  task: string
}

/** Width of a line's indentation after any blockquote prefix (tabs count as 4). */
function indentOf(line: string): number {
  const rest = line.slice(line.match(QUOTE_RE)![0].length)
  const ws = rest.match(/^[ \t]*/)![0]
  return ws.replace(/\t/g, '    ').length
}

function leadIndent(lead: string): number {
  return indentOf(`${lead}x`)
}

/** Parse the item whose first line is `start`; `textEnd` is its text's end (from the source map). */
export function parseItem(lines: string[], start: number, textEnd = start + 1): ListItem | null {
  const m = lines[start]?.match(ITEM_RE)
  if (!m)
    return null
  const [, lead, marker, rawGap, task = ''] = m
  // A bare marker (an empty item saved as `-`) gets the usual single space when text follows.
  const gap = rawGap || ' '
  const own = leadIndent(lead)
  // Everything indented deeper than the marker belongs to the item: continuation lines and nested lists.
  let end = textEnd
  while (end < lines.length && lines[end].trim() !== '' && indentOf(lines[end]) > own)
    end++
  return { start, textEnd, end, lead, marker, gap, task }
}

/** The item starting at `start`, with its text running until its nested list / next item. */
function itemAt(lines: string[], start: number): ListItem | null {
  const m = lines[start]?.match(ITEM_RE)
  if (!m)
    return null
  const own = leadIndent(m[1])
  let textEnd = start + 1
  while (textEnd < lines.length && lines[textEnd].trim() !== '' && !ITEM_RE.test(lines[textEnd]) && indentOf(lines[textEnd]) > own)
    textEnd++
  return parseItem(lines, start, textEnd)
}

function previousSibling(lines: string[], item: ListItem): ListItem | null {
  const own = leadIndent(item.lead)
  for (let i = item.start - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.trim() === '')
      return null
    const m = line.match(ITEM_RE)
    if (m && leadIndent(m[1]) === own)
      return itemAt(lines, i)
    if (indentOf(line) <= own && !m)
      return null
    if (m && leadIndent(m[1]) < own)
      return null
  }
  return null
}

function nextSibling(lines: string[], item: ListItem): ListItem | null {
  const m = lines[item.end]?.match(ITEM_RE)
  return m && leadIndent(m[1]) === leadIndent(item.lead) ? itemAt(lines, item.end) : null
}

function parentItem(lines: string[], item: ListItem): ListItem | null {
  const own = leadIndent(item.lead)
  for (let i = item.start - 1; i >= 0; i--) {
    if (lines[i].trim() === '')
      return null
    const m = lines[i].match(ITEM_RE)
    if (m && leadIndent(m[1]) < own)
      return itemAt(lines, i)
  }
  return null
}

/** The nearest list item above `item` at any depth (what Backspace at its start joins onto). */
function previousItem(lines: string[], item: ListItem): ListItem | null {
  for (let i = item.start - 1; i >= 0; i--) {
    if (lines[i].trim() === '')
      return null
    if (ITEM_RE.test(lines[i]))
      return itemAt(lines, i)
  }
  return null
}

/** All items of the sibling run `item` belongs to, top to bottom. */
function siblingRun(lines: string[], item: ListItem): ListItem[] {
  let first = item
  for (let p = previousSibling(lines, first); p; p = previousSibling(lines, p))
    first = p
  const run = [first]
  for (let n = nextSibling(lines, first); n; n = nextSibling(lines, n))
    run.push(n)
  return run
}

const ORDERED_RE = /^(\d+)([.)])$/

/** Whether an ordered run is numbered 1, 2, 3… (from its first number), rather than e.g. all `1.`. */
function isSequential(run: ListItem[]): boolean {
  const nums = run.map(i => i.marker.match(ORDERED_RE)?.[1])
  return run.length > 1 && nums.every((n, k) => n != null && Number(n) === Number(nums[0]) + k)
}

/** Renumber a sequential ordered run in place, after items were added, removed or moved. */
function renumber(lines: string[], at: number): void {
  const item = itemAt(lines, at)
  if (!item || !ORDERED_RE.test(item.marker))
    return
  const run = siblingRun(lines, item)
  const first = Number(run[0].marker.match(ORDERED_RE)![1])
  run.forEach((it, k) => {
    const [, , delim] = it.marker.match(ORDERED_RE)!
    const marker = `${first + k}${delim}`
    if (marker !== it.marker)
      lines[it.start] = it.lead + marker + lines[it.start].slice(it.lead.length + it.marker.length)
  })
}

/** Where to put the caret after an op: the item starting at `line`, at a text offset or its end. */
export interface ListFocus {
  line: number
  offset: number | 'end'
}

export interface ListEditResult {
  content: string
  focus: ListFocus | null
}

function result(lines: string[], focus: ListFocus | null): ListEditResult {
  return { content: lines.join('\n'), focus }
}

function nextMarker(lines: string[], item: ListItem): string {
  const m = item.marker.match(ORDERED_RE)
  if (!m)
    return item.marker
  return isSequential(siblingRun(lines, item)) || siblingRun(lines, item).length === 1 ? `${Number(m[1]) + 1}${m[2]}` : item.marker
}

/**
 * Enter: the item keeps `before`, and a new sibling holding `after` goes right below its text
 * (so its nested list, if any, now belongs to the new item, as in other editors). The caret moves
 * to the start of the new item.
 */
export function splitItem(content: string, start: number, textEnd: number, before: string, after: string): ListEditResult {
  let lines = content.split('\n')
  const item = parseItem(lines, start, textEnd)!
  const run = siblingRun(lines, item)
  const sequential = ORDERED_RE.test(item.marker) && (isSequential(run) || run.length === 1)
  const marker = nextMarker(lines, item)
  lines = replaceBlockText(lines.join('\n'), [start, textEnd], before).split('\n')
  const newTextEnd = start + before.split('\n').length
  const box = item.task ? '[ ] ' : ''
  lines.splice(newTextEnd, 0, `${item.lead}${marker}${item.gap}${box}${after}`)
  if (sequential)
    renumber(lines, start)
  return result(lines, { line: newTextEnd, offset: 0 })
}

// After removing `item`'s text lines (`removed` of them), renumber its run if it was sequential.
function renumberAfterRemoval(lines: string[], run: ListItem[], item: ListItem, removed: number, wasSequential: boolean): void {
  const other = run.find(r => r.start !== item.start)
  if (wasSequential && other)
    renumber(lines, other.start > item.start ? other.start - removed : other.start)
}

/** Enter on an empty item: remove it and stop editing. */
export function removeItem(content: string, start: number, textEnd: number): ListEditResult {
  const lines = content.split('\n')
  const item = parseItem(lines, start, textEnd)!
  const run = siblingRun(lines, item)
  const sequential = ORDERED_RE.test(item.marker) && isSequential(run)
  lines.splice(start, textEnd - start)
  renumberAfterRemoval(lines, run, item, textEnd - start, sequential)
  return result(lines, null)
}

/**
 * Backspace at the start of an item: append its text to the item above (any depth) and remove
 * it; an empty item is just removed. The caret goes to the join point. `null` when there's no
 * item above (the first item of a list).
 */
export function mergeIntoPrevious(content: string, start: number, textEnd: number, text: string, previousTextLength: number): ListEditResult | null {
  const lines = content.split('\n')
  const item = parseItem(lines, start, textEnd)!
  const prev = previousItem(lines, item)
  if (!prev)
    return null
  const run = siblingRun(lines, item)
  const sequential = ORDERED_RE.test(item.marker) && isSequential(run)
  const prevLast = prev.textEnd - 1
  lines.splice(start, textEnd - start)
  if (text)
    lines[prevLast] = lines[prevLast].replace(/[ \t]+$/, '') + text
  renumberAfterRemoval(lines, run, item, textEnd - start, sequential)
  return result(lines, { line: prev.start, offset: text ? previousTextLength : 'end' })
}

/** Shift the lines of an item block by `delta` columns of indentation (after any blockquote). */
function shiftBlock(lines: string[], from: number, to: number, delta: number): void {
  for (let i = from; i < to; i++) {
    const quote = lines[i].match(QUOTE_RE)![0]
    const rest = lines[i].slice(quote.length)
    if (delta > 0)
      lines[i] = quote + ' '.repeat(delta) + rest
    else
      lines[i] = quote + rest.replace(new RegExp(`^ {0,${-delta}}`), '')
  }
}

/** Tab: nest the item (with its own nested list) under its previous sibling. */
export function indentItem(content: string, start: number, textEnd: number, offset: number): ListEditResult | null {
  const lines = content.split('\n')
  const item = parseItem(lines, start, textEnd)!
  const prev = previousSibling(lines, item)
  if (!prev)
    return null
  const run = siblingRun(lines, item)
  const sequential = ORDERED_RE.test(item.marker) && isSequential(run)
  // Align under the previous sibling's text.
  const delta = prev.lead.length + prev.marker.length + prev.gap.length - item.lead.length
  shiftBlock(lines, item.start, item.end, delta)
  if (sequential)
    renumber(lines, run[0].start)
  return result(lines, { line: start, offset })
}

/** ⇧Tab: lift the item (with its nested list) to its parent's level, right after the parent's text. */
export function outdentItem(content: string, start: number, textEnd: number, offset: number): ListEditResult | null {
  const lines = content.split('\n')
  const item = parseItem(lines, start, textEnd)!
  const parent = parentItem(lines, item)
  if (!parent)
    return null
  const delta = leadIndent(parent.lead) - leadIndent(item.lead)
  // Siblings after it become its children (they follow it, more indented), as in other editors.
  shiftBlock(lines, item.start, item.end, delta)
  return result(lines, { line: start, offset })
}

/** ⌥↑ / ⌥↓: swap the item (with its nested list) with its previous / next sibling. */
export function moveItem(content: string, start: number, textEnd: number, direction: 'up' | 'down', offset: number): ListEditResult | null {
  const lines = content.split('\n')
  const item = parseItem(lines, start, textEnd)!
  const other = direction === 'up' ? previousSibling(lines, item) : nextSibling(lines, item)
  if (!other)
    return null
  const run = siblingRun(lines, item)
  const sequential = ORDERED_RE.test(item.marker) && isSequential(run)
  const [a, b] = direction === 'up' ? [other, item] : [item, other]
  const blockA = lines.slice(a.start, a.end)
  const blockB = lines.slice(b.start, b.end)
  lines.splice(a.start, b.end - a.start, ...blockB, ...blockA)
  const newStart = direction === 'up' ? a.start : a.start + blockB.length
  if (sequential)
    renumber(lines, run[0].start)
  return result(lines, { line: newStart, offset })
}

/** The first and last differing lines between two versions, for a history event's splice. */
export function changedRange(before: string, after: string): { lineRange: [number, number], lines: string[], after: string[] } {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start])
    start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return { lineRange: [start, endA], lines: a.slice(start, endA), after: b.slice(start, endB) }
}
