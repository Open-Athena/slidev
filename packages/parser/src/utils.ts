import { isNumber, range, uniq } from '@antfu/utils'

export * from './timesplit'
export * from './yaml-edit'

const RE_ASPECT_RATIO_SEPARATOR = /[:/x|]/

/**
 * 1,3-5,8 => [1, 3, 4, 5, 8]
 */
export function parseRangeString(total: number, rangeStr?: string) {
  if (!rangeStr || rangeStr === 'all' || rangeStr === '*')
    return range(1, total + 1)

  if (rangeStr === 'none')
    return []

  const indexes: number[] = []
  for (const part of rangeStr.split(/[,;]/g)) {
    if (!part.includes('-')) {
      indexes.push(+part)
    }
    else {
      const [start, end] = part.split('-', 2)
      indexes.push(
        ...range(+start, !end ? (total + 1) : (+end + 1)),
      )
    }
  }

  return uniq(indexes).filter(i => i <= total).sort((a, b) => a - b)
}

/**
 * Accepts `16/9` `1:1` `3x4`
 */
export function parseAspectRatio(str: string | number) {
  if (isNumber(str))
    return str
  if (!Number.isNaN(+str))
    return +str
  const [wStr = '', hStr = ''] = str.split(RE_ASPECT_RATIO_SEPARATOR)
  const w = Number.parseFloat(wStr.trim())
  const h = Number.parseFloat(hStr.trim())

  if (Number.isNaN(w) || Number.isNaN(h) || h === 0)
    throw new Error(`Invalid aspect ratio "${str}"`)

  return w / h
}

/** Whether `normalized` has as many lines as `source` (the precondition for `mergeEditedLines`). */
export function linesCorrespond(source: string, normalized: string): boolean {
  return source.split('\n').length === normalized.split('\n').length
}

/**
 * Write an edit back without a serializer rewriting text nobody touched. `normalized` is the
 * serializer's output for the unedited `source` (line for line with it); `edited` is its output
 * after the edit. Lines the edit didn't change keep their original bytes; changed and added lines
 * come from `edited` (a line-level longest-common-subsequence diff).
 */
export function mergeEditedLines(source: string, normalized: string, edited: string): string {
  const src = source.split('\n')
  const a = normalized.split('\n')
  const b = edited.split('\n')
  if (src.length !== a.length)
    throw new Error('`normalized` must line up with `source`')
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from<number>({ length: b.length + 1 }).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(src[i])
      i++
      j++
    }
    else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push(b[j])
      j++
    }
    else {
      i++
    }
  }
  return out.join('\n')
}
