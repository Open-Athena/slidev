import { describe, expect, it } from 'vitest'
import { findLineRun, sliceLineRange } from '../packages/client/composables/delete-source'

describe('sliceLineRange', () => {
  it('removes a single non-flanked line', () => {
    const r = sliceLineRange('a\nb\nc', 1, 2)
    expect(r.content).toBe('a\nc')
    expect(r.removed).toEqual({ start: 1, end: 2, lines: ['b'] })
  })

  it('removes a multi-line range without blank-flank collapse', () => {
    const r = sliceLineRange('a\nb\nc\nd', 1, 3)
    expect(r.content).toBe('a\nd')
    expect(r.removed).toEqual({ start: 1, end: 3, lines: ['b', 'c'] })
  })

  it('collapses one trailing blank when both flanks are blank', () => {
    // a / '' / X / '' / b   →   a / '' / b  (drop X and the trailing blank)
    const r = sliceLineRange('a\n\nX\n\nb', 2, 3)
    expect(r.content).toBe('a\n\nb')
    expect(r.removed).toEqual({ start: 2, end: 4, lines: ['X', ''] })
  })

  it('does not collapse if only one flank is blank', () => {
    // a / X / '' / b   →   a / '' / b  (no collapse — leading line is non-blank)
    const r = sliceLineRange('a\nX\n\nb', 1, 2)
    expect(r.content).toBe('a\n\nb')
    expect(r.removed).toEqual({ start: 1, end: 2, lines: ['X'] })
  })

  it('does not collapse at start of file (no preceding line)', () => {
    const r = sliceLineRange('X\n\nb', 0, 1)
    expect(r.content).toBe('\nb')
    expect(r.removed).toEqual({ start: 0, end: 1, lines: ['X'] })
  })

  it('does not collapse at end of file (no following line)', () => {
    const r = sliceLineRange('a\n\nX', 2, 3)
    expect(r.content).toBe('a\n')
    expect(r.removed).toEqual({ start: 2, end: 3, lines: ['X'] })
  })

  it('handles empty content', () => {
    const r = sliceLineRange('', 0, 0)
    expect(r.content).toBe('')
    expect(r.removed).toEqual({ start: 0, end: 0, lines: [] })
  })

  it('round-trip splice + re-insert yields original', () => {
    const original = 'header\n\nimage-line\n\nfooter'
    const r = sliceLineRange(original, 2, 3)
    const afterLines = r.content.split('\n')
    const restored = [
      ...afterLines.slice(0, r.removed.start),
      ...r.removed.lines,
      ...afterLines.slice(r.removed.start),
    ].join('\n')
    expect(restored).toBe(original)
    // Effective range absorbed the trailing blank line
    expect(r.removed).toEqual({ start: 2, end: 4, lines: ['image-line', ''] })
  })

  it('records the originally requested range when no collapse happens', () => {
    const r = sliceLineRange('a\nb\nc\nd\ne', 1, 4)
    expect(r.removed.start).toBe(1)
    expect(r.removed.end).toBe(4)
    expect(r.removed.lines).toEqual(['b', 'c', 'd'])
  })
})

describe('findLineRun', () => {
  it('finds a single-line needle at the start', () => {
    expect(findLineRun(['a', 'b', 'c'], ['a'])).toBe(0)
  })

  it('finds a single-line needle in the middle', () => {
    expect(findLineRun(['a', 'b', 'c'], ['b'])).toBe(1)
  })

  it('finds a single-line needle at the end', () => {
    expect(findLineRun(['a', 'b', 'c'], ['c'])).toBe(2)
  })

  it('finds a multi-line needle', () => {
    expect(findLineRun(['a', 'b', 'c', 'd'], ['b', 'c'])).toBe(1)
  })

  it('returns -1 when needle is not present', () => {
    expect(findLineRun(['a', 'b', 'c'], ['x'])).toBe(-1)
  })

  it('returns -1 when needle is partially present (not consecutive)', () => {
    // 'a' and 'c' appear, but not consecutively
    expect(findLineRun(['a', 'b', 'c'], ['a', 'c'])).toBe(-1)
  })

  it('returns the first match when needle appears multiple times', () => {
    expect(findLineRun(['x', 'a', 'b', 'x', 'a', 'b'], ['a', 'b'])).toBe(1)
  })

  it('returns -1 for an empty needle', () => {
    expect(findLineRun(['a', 'b'], [])).toBe(-1)
  })

  it('returns -1 when needle is longer than haystack', () => {
    expect(findLineRun(['a'], ['a', 'b'])).toBe(-1)
  })

  it('matches blank lines literally', () => {
    expect(findLineRun(['a', '', 'b'], [''])).toBe(1)
    expect(findLineRun(['a', '', 'b'], ['', 'b'])).toBe(1)
  })

  it('matches the full haystack', () => {
    expect(findLineRun(['a', 'b'], ['a', 'b'])).toBe(0)
  })
})
