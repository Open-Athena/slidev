import { describe, expect, it } from 'vitest'
import { appendSnippet, elementSnippet, findElement, idForCopy, offsetPos, removeRange, uniqueId } from '../packages/client/composables/element-copy'

describe('elementSnippet', () => {
  it('finds the element itself within its lines', () => {
    expect([
      elementSnippet(['Text ![shot](/img/a.png) more'], { src: '/img/a.png', dragId: 'img-a' }),
      elementSnippet(['<div><img class="x" src="/img/a.png" /> after</div>'], { src: '/img/a.png', dragId: 'img-a' }),
      elementSnippet([`<Scrn v-drag="'shot'" src="/s.png" :w="w > 1" />`], { src: null, dragId: 'shot' }),
      elementSnippet(['<OgPreviews', '  :cards="[1]"', '/>'], { src: null, dragId: 'cmp-og-previews' }),
    ]).toEqual([
      '![shot](/img/a.png)',
      '<img class="x" src="/img/a.png" />',
      `<Scrn v-drag="'shot'" src="/s.png" :w="w > 1" />`,
      '<OgPreviews\n  :cards="[1]"\n/>',
    ])
  })

  it('searching a whole slide, finds the element or nothing', () => {
    const slide = ['# T', '', '<img src="/a.png" class="r" />', '', '<OgPreviews :cards="[1]" />']
    expect([
      elementSnippet(slide, { src: '/a.png', dragId: 'img-a' }, false),
      elementSnippet(slide, { src: null, dragId: 'cmp-og-previews' }, false),
      elementSnippet(slide, { src: null, dragId: 'cmp-gcs-bill' }, false),
    ]).toEqual(['<img src="/a.png" class="r" />', '<OgPreviews :cards="[1]" />', null])
  })

  it('picks the nth occurrence for a numbered auto id', () => {
    const slide = ['![one](/a.png)', '', '<img src="/a.png" alt="two" />', '', '<Tip>a</Tip>', '<Tip>b</Tip>']
    expect([
      elementSnippet(slide, { src: '/a.png', dragId: 'img-a-2' }, false),
      elementSnippet(slide, { src: null, dragId: 'cmp-tip-2' }, false),
    ]).toEqual(['<img src="/a.png" alt="two" />', '<Tip>b</Tip>'])
  })
})

describe('idForCopy', () => {
  it('renames an explicit id, and predicts the next auto id otherwise', () => {
    expect([
      idForCopy(`<div v-drag="'box'">x</div>`, 'box', ['box', 'box-copy']),
      idForCopy(`<VDrag pos="note">x</VDrag>`, 'note', ['note']),
      idForCopy('![](/img/a.png)', 'img-a', ['img-a', 'img-b']),
      idForCopy('![](/img/a.png)', 'img-a-2', ['img-a', 'img-a-2', 'img-b']),
    ]).toEqual([
      { snippet: `<div v-drag="'box-copy-2'">x</div>`, dragId: 'box-copy-2' },
      { snippet: `<VDrag pos="note-copy">x</VDrag>`, dragId: 'note-copy' },
      { snippet: '![](/img/a.png)', dragId: 'img-a-2' },
      { snippet: '![](/img/a.png)', dragId: 'img-a-3' },
    ])
    // A basename ending in digits isn't a repeat counter.
    expect([
      idForCopy('<img src="/img/shot-0813.png" />', 'img-shot-0813', ['img-shot-0813']),
      idForCopy('<OgPreviews :cards="[1]" />', 'cmp-og-previews', ['cmp-og-previews', 'img-x']),
    ]).toEqual([
      { snippet: '<img src="/img/shot-0813.png" />', dragId: 'img-shot-0813-2' },
      { snippet: '<OgPreviews :cards="[1]" />', dragId: 'cmp-og-previews-2' },
    ])
    expect(uniqueId('box-copy', new Set(['box-copy']))).toBe('box-copy-2')
  })
})

describe('offsetPos / appendSnippet', () => {
  it('shifts left / top only, and appends as a block', () => {
    expect(offsetPos('100,50,300,200,15,101', 20, 20)).toBe('120,70,300,200,15,101')
    expect([appendSnippet('# T\n\ntext\n\n', '![](/a.png)'), appendSnippet('', '![](/a.png)')]).toEqual([
      '# T\n\ntext\n\n![](/a.png)',
      '![](/a.png)',
    ])
  })
})

describe('findElement / removeRange', () => {
  const del = (text: string, el: { src?: string | null, dragId: string }) => {
    const at = findElement(text, el)!
    return removeRange(text, at.start, at.end)
  }

  it('removes an element\'s line, collapsing the blank lines around it', () => {
    expect(del('# T\n\n<img src="/a.png" />\n\nAfter', { src: '/a.png', dragId: 'img-a' })).toBe('# T\n\nAfter')
    expect(del('# T\n\n<OgPreviews :c="[1]" />\n', { dragId: 'cmp-og-previews' })).toBe('# T')
  })

  it('removes just the element when its line has other content', () => {
    expect(del('Before ![x](/a.png) after', { src: '/a.png', dragId: 'img-a' })).toBe('Before  after')
    expect(del('<div class="g"><img src="/a.png" /><img src="/a.png" /></div>', { src: '/a.png', dragId: 'img-a-2' })).toBe('<div class="g"><img src="/a.png" /></div>')
  })
})
