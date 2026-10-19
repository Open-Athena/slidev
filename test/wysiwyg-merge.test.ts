import { describe, expect, it } from 'vitest'
import { linesCorrespond, mergeEdited } from '../packages/client/composables/wysiwyg-merge'

const md = (...lines: string[]) => lines.join('\n')

describe('mergeEdited', () => {
  // The editor escapes `&` and `~` (and pads tables); untouched lines must keep their bytes.
  const source = md('# Outline', '', '* Q&A', '* ~1 day', '* History')
  const normalized = md('# Outline', '', '* Q\\&A', '* \\~1 day', '* History')

  it('keeps the original bytes of every line the edit didn\'t touch', () => {
    expect(mergeEdited(source, normalized, md('# Outline', '', '* Q\\&A', '* \\~1 day', '* History, again'))).toBe(
      md('# Outline', '', '* Q&A', '* ~1 day', '* History, again'),
    )
  })

  it('handles inserted and deleted lines', () => {
    expect([
      mergeEdited(source, normalized, md('# Outline', '', '* Q\\&A', '* new', '* \\~1 day', '* History')),
      mergeEdited(source, normalized, md('# Outline', '', '* \\~1 day', '* History')),
    ]).toEqual([
      md('# Outline', '', '* Q&A', '* new', '* ~1 day', '* History'),
      md('# Outline', '', '* ~1 day', '* History'),
    ])
  })

  it('is a no-op when nothing changed', () => {
    expect(mergeEdited(source, normalized, normalized)).toBe(source)
  })

  it('requires the normalized text to line up with the source', () => {
    expect([linesCorrespond(source, normalized), linesCorrespond('a\nb', 'a b')]).toEqual([true, false])
  })
})
