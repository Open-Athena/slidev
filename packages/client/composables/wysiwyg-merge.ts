// Write a WYSIWYG edit back without the serializer rewriting text nobody touched. `normalized` is
// the editor's serialization of the unedited source (escapes, list markers, … normalized), line
// for line with `source`; `edited` is its serialization after editing. Lines the edit didn't
// change keep their original bytes; changed and added lines come from `edited`. Pure, tested in
// `test/wysiwyg-merge.test.ts`.

/** Whether `normalized` lines up with `source` line for line (the precondition for merging). */
export function linesCorrespond(source: string, normalized: string): boolean {
  return source.split('\n').length === normalized.split('\n').length
}

export function mergeEdited(source: string, normalized: string, edited: string): string {
  const src = source.split('\n')
  const a = normalized.split('\n')
  const b = edited.split('\n')
  if (src.length !== a.length)
    throw new Error('`normalized` must line up with `source`')
  // Longest common subsequence of lines, by dynamic programming (regions are small).
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
