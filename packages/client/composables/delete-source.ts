// Pure helpers for the `delete` EditKind: splicing markdown source lines, locating a
// previously-removed run for re-removal on redo. Extracted from `useDeleteElement.ts`
// and `useDragHistory.ts` so they can be unit-tested without a Vue runtime or any of
// the vite virtual modules the composables transitively import.
//
// See `specs/delete-and-insert-flow.md` (Stage 1) and the
// `[[project-delete-undo-lineRange-brittleness]]` memory for the design rationale.

export interface SpliceResult {
  /** Slide content with the removed run dropped. */
  content: string
  /** Effective range removed (may extend `endLine` to absorb a redundant blank line). */
  removed: {
    start: number
    end: number
    lines: string[]
  }
}

/**
 * Strip lines `[startLine, endLine)` (0-indexed, end exclusive — markdown-it convention)
 * from a slide's content. If both the line immediately before and the line immediately
 * after the range are blank, the trailing blank is folded into the splice so we don't
 * leave a doubled gap where a paragraph used to live.
 *
 * Returns the new content plus the *effective* splice range and the literal lines
 * removed — the caller records this so undo/redo can reproduce the same splice.
 */
export function sliceLineRange(
  content: string,
  startLine: number,
  endLine: number,
): SpliceResult {
  const lines = content.split('\n')
  let effectiveEnd = endLine
  if (startLine > 0 && endLine < lines.length && lines[startLine - 1] === '' && lines[endLine] === '')
    effectiveEnd = endLine + 1
  const removedLines = lines.slice(startLine, effectiveEnd)
  const nextContent = [...lines.slice(0, startLine), ...lines.slice(effectiveEnd)].join('\n')
  return {
    content: nextContent,
    removed: { start: startLine, end: effectiveEnd, lines: removedLines },
  }
}

/**
 * Search for an exact consecutive match of `needle` in `haystack`. Returns the start
 * index (0-based) where the run begins, or -1 if no match. Empty needle never matches.
 *
 * Used by `applyDeleteSplice` to locate a previously-inserted run by content rather
 * than by stored line index, which goes stale across slidev's source normalization.
 */
export function findLineRun(haystack: string[], needle: string[]): number {
  if (needle.length === 0)
    return -1
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((line, j) => haystack[i + j] === line))
      return i
  }
  return -1
}
