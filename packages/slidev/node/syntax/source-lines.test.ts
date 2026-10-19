import type MagicString from 'magic-string-stack'
import MarkdownExit from 'markdown-exit'
import { expect, it } from 'vitest'
import MarkdownItSourceLines from './source-lines'

function render(src: string) {
  const md = MarkdownExit({ html: true })
  md.use(MarkdownItSourceLines, new Map<string, MagicString>())
  return md.renderAsync(src, { id: 'test' })
}

it('tags headings, paragraphs, list items and table cells with their source lines', async () => {
  const src = [
    '# Title',
    '',
    'A paragraph',
    'over two lines.',
    '',
    '- tight item',
    '- another',
    '  - nested',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```ts',
    'const notTagged = 1',
    '```',
  ].join('\n')
  expect((await render(src)).trim().split('\n')).toEqual([
    '<h1 data-slidev-block="0,1" data-slidev-md="0,1">Title</h1>',
    '<p data-slidev-block="2,4" data-slidev-md="2,4">A paragraph',
    'over two lines.</p>',
    '<ul data-slidev-block="5,9">',
    '<li data-slidev-md="5,6">tight item</li>',
    '<li data-slidev-md="6,7">another',
    '<ul>',
    '<li data-slidev-md="7,8">nested</li>',
    '</ul>',
    '</li>',
    '</ul>',
    '<table data-slidev-block="9,12">',
    '<thead>',
    '<tr>',
    '<th data-slidev-md="9,10" data-slidev-md-cell="0">A</th>',
    '<th data-slidev-md="9,10" data-slidev-md-cell="1">B</th>',
    '</tr>',
    '</thead>',
    '<tbody>',
    '<tr>',
    '<td data-slidev-md="11,12" data-slidev-md-cell="0">1</td>',
    '<td data-slidev-md="11,12" data-slidev-md-cell="1">2</td>',
    '</tr>',
    '</tbody>',
    '</table>',
    '<pre><code class="language-ts">const notTagged = 1',
    '</code></pre>',
  ])
})

it('tags the paragraph (and its item) in loose lists', async () => {
  expect((await render('- one\n\n- two')).trim().split('\n')).toEqual([
    '<ul data-slidev-block="0,3">',
    '<li data-slidev-md="0,1">',
    '<p data-slidev-md="0,1">one</p>',
    '</li>',
    '<li data-slidev-md="2,3">',
    '<p data-slidev-md="2,3">two</p>',
    '</li>',
    '</ul>',
  ])
})

it('tags block-level HTML tags with their source line and index on that line', async () => {
  const src = [
    'Intro',
    '',
    '<div class="grid" style="grid-template-columns: 1fr 2fr">',
    '<!-- <div> in a comment -->',
    '<div><section>',
    '',
    'Markdown in a cell',
    '',
    '</section></div>',
    '<span>inline</span>',
    '</div>',
  ].join('\n')
  expect((await render(src)).trim().split('\n')).toEqual([
    '<p data-slidev-block="0,1" data-slidev-md="0,1">Intro</p>',
    '<div data-slidev-html="2:0" class="grid" style="grid-template-columns: 1fr 2fr">',
    '<!-- <div> in a comment -->',
    '<div data-slidev-html="4:0"><section data-slidev-html="4:1">',
    '<p data-slidev-block="6,7" data-slidev-md="6,7">Markdown in a cell</p>',
    '</section></div>',
    '<span>inline</span>',
    '</div>',
  ])
})

it('tags an empty list item with its first line', async () => {
  expect((await render('- a\n- \n- c')).trim().split('\n')).toEqual([
    '<ul data-slidev-block="0,3">',
    '<li data-slidev-md="0,1">a</li>',
    '<li data-slidev-md="1,2"></li>',
    '<li data-slidev-md="2,3">c</li>',
    '</ul>',
  ])
})
