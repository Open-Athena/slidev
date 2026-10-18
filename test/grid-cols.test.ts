import { describe, expect, it } from 'vitest'

import {
  colsToTemplate,
  findOpeningTag,
  formatFr,
  formatPercent,
  isFlexibleTemplate,
  parseComputedTracks,
  parseHtmlTagRef,
  resizePair,
  setTagGridColumns,
  snapPair,
  tagGridColumns,
} from '../packages/client/composables/grid-cols'

describe('parsing', () => {
  it('reads tag refs and computed track sizes', () => {
    expect([
      parseHtmlTagRef('12:1'),
      parseHtmlTagRef('x'),
      parseHtmlTagRef(null),
    ]).toEqual([{ line: 12, index: 1 }, null, null])
    expect([
      parseComputedTracks('312px 408.5px'),
      parseComputedTracks('300px'),
      parseComputedTracks('none'),
      parseComputedTracks('100px auto'),
    ]).toEqual([[312, 408.5], null, null, null])
  })

  it('accepts only all-flexible authored templates', () => {
    expect([
      '1fr 1.45fr',
      'repeat(3, 1fr)',
      'repeat(2, minmax(0, 1fr))',
      '1fr auto 1fr',
      '200px 1fr',
      '1fr',
    ].map(isFlexibleTemplate)).toEqual([true, true, true, false, false, true])
  })

  it('turns `cols` frontmatter into a template', () => {
    expect([
      colsToTemplate('40/60'),
      colsToTemplate('30 / 40 / 30'),
      colsToTemplate([2, 3]),
      colsToTemplate('60'),
      colsToTemplate('a/b'),
      colsToTemplate(undefined),
    ]).toEqual(['40fr 60fr', '30fr 40fr 30fr', '2fr 3fr', undefined, undefined, undefined])
  })
})

describe('formatting', () => {
  it('writes fr tracks with the narrowest at 1fr, and percents summing to 100', () => {
    expect([
      formatFr([300, 435]),
      formatFr([400, 400]),
      formatFr([270, 200, 330]),
    ]).toEqual(['1fr 1.45fr', '1fr 1fr', '1.35fr 1fr 1.65fr'])
    expect([
      formatPercent([2, 3]),
      formatPercent([1, 1, 1]),
      formatPercent([333, 667]),
    ]).toEqual(['40/60', '34/33/33', '33/67'])
  })
})

describe('dragging', () => {
  it('moves the boundary between two tracks, keeping their sum and a minimum width', () => {
    expect([
      resizePair([400, 400], 0, 100, 60),
      resizePair([400, 400], 0, -390, 60),
      resizePair([200, 300, 300], 1, 50, 60),
    ]).toEqual([[500, 300], [60, 740], [200, 350, 250]])
  })

  it('snaps to common ratios within the threshold', () => {
    expect([
      snapPair(395, 800, 8),
      snapPair(270, 800, 8),
      snapPair(300, 800, 8),
    ]).toEqual([
      { left: 400, label: '½' },
      { left: 1 / 3 * 800, label: '⅓' },
      { left: 305.6, label: 'φ' },
    ])
  })
})

describe('rewriting the slide markdown', () => {
  const content = [
    '# Title',
    '',
    '<div class="grid gap-6" style="grid-template-columns: 1fr 1.45fr">',
    '<div class="a"><div class="b" title="x > y">',
  ].join('\n')

  it('finds the k-th tag on a line', () => {
    const at = (line: number, index: number) => {
      const r = findOpeningTag(content, { line, index })
      return r && content.slice(r.start, r.end)
    }
    expect([at(2, 0), at(3, 0), at(3, 1), at(3, 2), at(9, 0)]).toEqual([
      '<div class="grid gap-6" style="grid-template-columns: 1fr 1.45fr">',
      '<div class="a">',
      '<div class="b" title="x > y">',
      null,
      null,
    ])
  })

  it('reads and sets a tag\'s inline grid columns', () => {
    expect([
      tagGridColumns('<div style="gap: 4px; grid-template-columns: 1fr 2fr">'),
      tagGridColumns('<div class="grid grid-cols-2">'),
    ]).toEqual(['1fr 2fr', null])
    expect([
      setTagGridColumns('<div class="grid" style="grid-template-columns: 1fr 1.45fr">', '1fr 2fr'),
      setTagGridColumns('<div class="grid" style="gap: 4px;">', '1fr 2fr'),
      setTagGridColumns('<div class="grid grid-cols-2">', '1fr 2fr'),
      setTagGridColumns('<div class=\'grid\' style=\'color: red\'>', '1fr 2fr'),
    ]).toEqual([
      '<div class="grid" style="grid-template-columns: 1fr 2fr">',
      '<div class="grid" style="gap: 4px; grid-template-columns: 1fr 2fr">',
      '<div class="grid grid-cols-2" style="grid-template-columns: 1fr 2fr">',
      '<div class=\'grid\' style=\'color: red; grid-template-columns: 1fr 2fr\'>',
    ])
  })
})
