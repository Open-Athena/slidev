import { describe, expect, it } from 'vitest'
import {
  changedRange,
  indentItem,
  mergeIntoPrevious,
  moveItem,
  outdentItem,
  removeItem,
  splitItem,
} from '../packages/client/composables/list-edit'

const md = (...lines: string[]) => lines.join('\n')

describe('splitItem (Enter)', () => {
  it('inserts a sibling below the item\'s text, carrying the text after the caret', () => {
    const src = md('- Percy GCP bill', '- disky', '  - nested', '- History')
    expect(splitItem(src, 1, 2, 'di', 'sky')).toEqual({
      content: md('- Percy GCP bill', '- di', '- sky', '  - nested', '- History'),
      focus: { line: 2, offset: 0 },
    })
    expect(splitItem(src, 3, 4, 'History', '').content).toBe(md('- Percy GCP bill', '- disky', '  - nested', '- History', '- '))
  })

  it('keeps the marker, indentation and (an unchecked) task box', () => {
    expect(splitItem(md('* a', '  * [x] done', '* b'), 1, 2, 'done', 'next').content)
      .toBe(md('* a', '  * [x] done', '  * [ ] next', '* b'))
    expect(splitItem(md('> - quoted'), 0, 1, 'quoted', 'more').content).toBe(md('> - quoted', '> - more'))
  })

  it('renumbers a sequential ordered list, and leaves lazy `1.` numbering alone', () => {
    expect(splitItem(md('1. one', '2. two', '3. three'), 0, 1, 'one', 'new').content)
      .toBe(md('1. one', '2. new', '3. two', '4. three'))
    expect(splitItem(md('1. one', '1. two'), 0, 1, 'one', 'new').content)
      .toBe(md('1. one', '1. new', '1. two'))
  })
})

describe('bare markers (an empty item saved as `-`)', () => {
  it('are items, and get a space when text is added', () => {
    expect(splitItem(md('- a', '-'), 1, 2, 'b', 'c').content).toBe(md('- a', '- b', '- c'))
  })
})

describe('removeItem (Enter on an empty item)', () => {
  it('removes the item and stops editing', () => {
    expect(removeItem(md('- a', '- ', '- b'), 1, 2)).toEqual({ content: md('- a', '- b'), focus: null })
    expect(removeItem(md('1. a', '2. ', '3. b'), 1, 2).content).toBe(md('1. a', '2. b'))
  })
})

describe('mergeIntoPrevious (Backspace at the start)', () => {
  it('joins the text onto the item above, caret at the join', () => {
    expect(mergeIntoPrevious(md('- abc', '- def', '- g'), 1, 2, 'def', 3)).toEqual({
      content: md('- abcdef', '- g'),
      focus: { line: 0, offset: 3 },
    })
  })

  it('joins onto a nested item above, and removes an empty item with the caret at that item\'s end', () => {
    expect(mergeIntoPrevious(md('- a', '  - deep', '- b'), 2, 3, 'b', 4)!.content).toBe(md('- a', '  - deepb'))
    expect(mergeIntoPrevious(md('- a', '- ', '- b'), 1, 2, '', 1)).toEqual({ content: md('- a', '- b'), focus: { line: 0, offset: 'end' } })
  })

  it('does nothing on the first item', () => {
    expect(mergeIntoPrevious(md('Intro', '', '- a'), 2, 3, 'a', 0)).toBe(null)
  })
})

describe('indentItem / outdentItem (Tab / ⇧Tab)', () => {
  it('nests an item and its children under the previous sibling, aligned with its text', () => {
    expect(indentItem(md('- a', '- b', '  - b1', '- c'), 1, 2, 0)).toEqual({
      content: md('- a', '  - b', '    - b1', '- c'),
      focus: { line: 1, offset: 0 },
    })
    expect(indentItem(md('10. a', '11. b', '12. c'), 1, 2, 0)!.content).toBe(md('10. a', '    11. b', '11. c'))
    expect(indentItem(md('- a', '- b'), 0, 1, 0)).toBe(null)
  })

  it('lifts a nested item to its parent\'s level; siblings after it become its children', () => {
    expect(outdentItem(md('- a', '  - a1', '  - a2', '  - a3', '- b'), 2, 3, 1)).toEqual({
      content: md('- a', '  - a1', '- a2', '  - a3', '- b'),
      focus: { line: 2, offset: 1 },
    })
    expect(outdentItem(md('- a', '- b'), 1, 2, 0)).toBe(null)
  })
})

describe('moveItem (⌥↑ / ⌥↓)', () => {
  it('swaps an item and its nested list with a sibling', () => {
    const src = md('- a', '- b', '  - b1', '- c')
    expect(moveItem(src, 1, 2, 'up', 2)).toEqual({ content: md('- b', '  - b1', '- a', '- c'), focus: { line: 0, offset: 2 } })
    expect(moveItem(src, 1, 2, 'down', 0)).toEqual({ content: md('- a', '- c', '- b', '  - b1'), focus: { line: 2, offset: 0 } })
    expect(moveItem(src, 0, 1, 'up', 0)).toBe(null)
  })

  it('keeps sequential numbering in order', () => {
    expect(moveItem(md('1. a', '2. b', '3. c'), 2, 3, 'up', 0)!.content).toBe(md('1. a', '2. c', '3. b'))
  })
})

describe('changedRange', () => {
  it('spans only the lines that differ', () => {
    expect(changedRange(md('x', '- a', '- b', 'y'), md('x', '- a', '- new', '- b', 'y'))).toEqual({
      lineRange: [2, 2],
      lines: [],
      after: ['- new'],
    })
  })
})
