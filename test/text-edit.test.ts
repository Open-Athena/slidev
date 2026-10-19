import type { InlineNode } from '../packages/client/composables/text-edit'
import { describe, expect, it } from 'vitest'

// Pure text-editing helpers live in `./text-edit` (used by `useTextEditing`), so these tests don't
// need a Vue runtime, a DOM, or the vite virtual modules the composable pulls in.
import {
  blockSourceText,
  cellSourceText,
  looksLikeSameBlock,
  parseLineRange,
  replaceBlockText,
  replaceTableCell,
  serializeInline,
  spliceLines,
  splitPrefix,
} from '../packages/client/composables/text-edit'

// Minimal DOM stand-ins for the serializer.
function text(s: string): InlineNode {
  return { nodeType: 3, nodeName: '#text', textContent: s, childNodes: [] }
}
function el(name: string, children: InlineNode[], attrs: Record<string, string> = {}): InlineNode {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    textContent: children.map(c => c.textContent ?? '').join(''),
    childNodes: children,
    getAttribute: n => attrs[n] ?? null,
  }
}

describe('parseLineRange', () => {
  it('parses `start,end` and rejects empty or malformed ranges', () => {
    expect([
      parseLineRange('3,5'),
      parseLineRange('3,3'),
      parseLineRange('x'),
      parseLineRange(null),
    ]).toEqual([[3, 5], null, null, null])
  })
})

describe('splitPrefix', () => {
  it('separates block markers from text', () => {
    expect([
      '# Title',
      '### Sub title',
      '- item',
      '  * nested',
      '12. numbered',
      '- [x] done',
      '> quoted',
      '> - quoted item',
      'plain text',
      '#hashtag',
    ].map(splitPrefix)).toEqual([
      { prefix: '# ', text: 'Title' },
      { prefix: '### ', text: 'Sub title' },
      { prefix: '- ', text: 'item' },
      { prefix: '  * ', text: 'nested' },
      { prefix: '12. ', text: 'numbered' },
      { prefix: '- [x] ', text: 'done' },
      { prefix: '> ', text: 'quoted' },
      { prefix: '> - ', text: 'quoted item' },
      { prefix: '', text: 'plain text' },
      { prefix: '', text: '#hashtag' },
    ])
  })
})

describe('blockSourceText / replaceBlockText', () => {
  const slide = [
    '# Deep Dive',
    '',
    'First line of a paragraph',
    'continues here.',
    '',
    '- one',
    '- two **bold**',
    '  - nested',
    '',
    '> quoted line',
    '> and more',
    '',
    'Setext title',
    '============',
  ].join('\n')

  it('reads block text without markers, keeping soft breaks', () => {
    expect([
      blockSourceText(slide, [0, 1]),
      blockSourceText(slide, [2, 4]),
      blockSourceText(slide, [6, 7]),
      blockSourceText(slide, [9, 11]),
      blockSourceText(slide, [12, 14]),
    ]).toEqual([
      'Deep Dive',
      'First line of a paragraph\ncontinues here.',
      'two **bold**',
      'quoted line\nand more',
      'Setext title',
    ])
  })

  it('replaces a heading, keeping its marker and joining newlines', () => {
    expect(replaceBlockText(slide, [0, 1], 'Deep Dive:\nDisky').split('\n').slice(0, 2)).toEqual([
      '# Deep Dive: Disky',
      '',
    ])
  })

  it('replaces a multi-line paragraph with fewer lines, leaving the rest of the slide alone', () => {
    expect(replaceBlockText(slide, [2, 4], 'One line now.')).toBe([
      '# Deep Dive',
      '',
      'One line now.',
      '',
      '- one',
      '- two **bold**',
      '  - nested',
      '',
      '> quoted line',
      '> and more',
      '',
      'Setext title',
      '============',
    ].join('\n'))
  })

  it('replaces a list item without touching its nested list', () => {
    expect(replaceBlockText(slide, [6, 7], 'two *italic*').split('\n').slice(5, 8)).toEqual([
      '- one',
      '- two *italic*',
      '  - nested',
    ])
  })

  it('keeps blockquote markers on continuation lines', () => {
    expect(replaceBlockText(slide, [9, 11], 'first\nsecond\nthird').split('\n').slice(9, 12)).toEqual([
      '> first',
      '> second',
      '> third',
    ])
  })

  it('reads a bare marker as an empty item, and spaces text added to it', () => {
    expect([blockSourceText('- a\n-', [1, 2]), replaceBlockText('- a\n-', [1, 2], 'b')]).toEqual(['', '- a\n- b'])
    // An empty task item, its trailing space trimmed at the end of a slide.
    expect([blockSourceText('- [ ]', [0, 1]), replaceBlockText('- [ ]', [0, 1], 'next')]).toEqual(['', '- [ ] next'])
  })

  it('aligns new continuation lines under a list item\'s text', () => {
    expect(replaceBlockText('- item', [0, 1], 'item\nwrapped')).toBe('- item\n  wrapped')
  })

  it('keeps a setext heading\'s underline', () => {
    expect(replaceBlockText(slide, [12, 14], 'New title').split('\n').slice(12)).toEqual([
      'New title',
      '============',
    ])
  })

  it('rejects ranges past the end of the slide', () => {
    expect(() => blockSourceText('one line', [0, 3])).toThrow('Line range 0,3 is outside the slide (1 lines)')
  })
})

describe('table cells', () => {
  const table = [
    '| Deploy | Cost |',
    '|---|---|',
    '| gcs | ~$5.5 |',
    '| `a\\|b` | x |',
  ].join('\n')

  it('reads cells, honoring escaped pipes', () => {
    expect([
      cellSourceText(table, 0, 1),
      cellSourceText(table, 2, 0),
      cellSourceText(table, 3, 0),
    ]).toEqual(['Cost', 'gcs', '`a\\|b`'])
  })

  it('replaces one cell, escaping pipes in the new text', () => {
    expect(replaceTableCell(table, 2, 1, '~$6 | est.').split('\n')[2]).toBe('| gcs | ~$6 \\| est. |')
  })

  it('handles rows without outer pipes', () => {
    expect(replaceTableCell('a | b\n---|---\nc | d', 2, 1, 'e')).toBe('a | b\n---|---\nc | e ')
  })

  it('rejects cells past the end of the row', () => {
    expect(() => cellSourceText(table, 2, 5)).toThrow('Cell 5 is outside row 2 (2 cells)')
  })
})

describe('serializeInline', () => {
  it('turns inline formatting back into markdown', () => {
    const p = el('p', [
      text('Plain '),
      el('strong', [text('bold')]),
      text(', '),
      el('em', [text('italic')]),
      text(', '),
      el('code', [text('code')]),
      text(', '),
      el('a', [text('a link')], { href: 'https://x.com' }),
      text(', '),
      el('a', [text('https://bare.dev')], { href: 'https://bare.dev' }),
      text(', '),
      el('del', [text('gone')]),
    ])
    expect(serializeInline(p)).toBe('Plain **bold**, *italic*, `code`, [a link](https://x.com), https://bare.dev, ~~gone~~')
  })

  it('maps browser editing markup (b / i / bare spans) and moves edge whitespace outside delimiters', () => {
    const p = el('p', [el('b', [text('bold ')]), text('then'), el('span', [text(' more')]), el('i', [text(' it')])])
    expect(serializeInline(p)).toBe('**bold** then more *it*')
  })

  it('straightens typographer quotes and writes line breaks as `<br>`', () => {
    const h = el('h1', [text('Disky\u2019s \u201Cfriends\u201D:'), el('br', []), text('fleet disk usage')])
    expect(serializeInline(h)).toBe('Disky\'s "friends":<br>fleet disk usage')
  })

  it('uses a double-backtick fence for code containing backticks', () => {
    expect(serializeInline(el('p', [el('code', [text('a`b')])]))).toBe('`` a`b ``')
  })

  it('skips nested lists and task checkboxes in a list item', () => {
    const li = el('li', [el('input', []), text('parent'), el('ul', [el('li', [text('child')])])])
    const task = el('li', [el('input', []), text(' '), el('label', [text('done')])])
    expect([serializeInline(li), serializeInline(task)]).toEqual(['parent', ' done'])
  })

  it('gives up (null) on anything it cannot represent', () => {
    expect([
      serializeInline(el('p', [text('icon '), el('carbon-logo-github', [])])),
      serializeInline(el('p', [el('kbd', [text('⌘K')])])),
    ]).toEqual([null, null])
  })
})

describe('spliceLines', () => {
  it('replaces the occurrence nearest the hint', () => {
    const content = 'a\nx\nb\nx\nc'
    expect([
      spliceLines(content, ['x'], ['y'], 0),
      spliceLines(content, ['x'], ['y'], 4),
      spliceLines(content, ['x', 'b'], ['z'], 0),
      spliceLines(content, ['missing'], ['y'], 0),
    ]).toEqual([
      'a\ny\nb\nx\nc',
      'a\nx\nb\ny\nc',
      'a\nz\nx\nc',
      null,
    ])
  })
})

describe('looksLikeSameBlock', () => {
  it('matches rendered text against its markdown, ignoring syntax', () => {
    expect([
      looksLikeSameBlock('Plain bold, a link', 'Plain **bold**, [a link](https://x.com)'),
      looksLikeSameBlock('Deep Dive', 'Deep Dive'),
      looksLikeSameBlock('Icon GitHub', '<carbon-logo-github /> Icon GitHub'),
      looksLikeSameBlock('Something else entirely', 'Deep Dive'),
      looksLikeSameBlock('', ''),
      looksLikeSameBlock('Keyboard-{navigation,control}:', 'Keyboard-&#123;navigation,control&#125;:'),
      looksLikeSameBlock('disky \u2192 ?   dsk', '**disky** \u2192 ? &nbsp; dsk'),
    ]).toEqual([true, true, true, false, true, true, true])
  })
})
