import { describe, expect, it } from 'vitest'
import { deleteYamlIn, patchYaml, setYamlIn } from '../packages/parser/src/yaml-edit'

const y = (...lines: string[]) => lines.join('\n')

const deck = y(
  'theme: open-athena',
  'title: "Deep Dive: Disky & Friends"',
  `description: ${'A long description that a YAML serializer would fold at eighty columns, '.repeat(2).trim()}`,
  'draggableImageTags: [Scrn]',
  'publish:',
  '  baseUrl: https://disky-deep-dive.oa.dev   # `BASE_URL=… pnpm build` overrides',
  'qr:',
  '  position: br',
  '  size: 56',
  '  skipSlides: [1]',
  'opts: {a: 1, b: 2}',
  'info: Managing fleet disk usage',
)

describe('setYamlIn', () => {
  it('replaces a scalar in place, keeping its quoting and a trailing comment', () => {
    expect([
      setYamlIn(deck, ['qr', 'position'], 'tr'),
      setYamlIn(deck, ['title'], 'Disky'),
      setYamlIn(deck, ['publish', 'baseUrl'], 'https://x.dev'),
    ]).toEqual([
      deck.replace('  position: br', '  position: tr'),
      deck.replace('title: "Deep Dive: Disky & Friends"', 'title: "Disky"'),
      deck.replace('  baseUrl: https://disky-deep-dive.oa.dev   #', '  baseUrl: https://x.dev   #'),
    ])
  })

  it('replaces a flow sequence as a flow sequence', () => {
    expect(setYamlIn(deck, ['qr', 'skipSlides'], [1, 2])).toBe(deck.replace('skipSlides: [1]', 'skipSlides: [1, 2]'))
  })

  it('adds keys after their siblings, at their indentation, with block collections indented', () => {
    expect([
      setYamlIn(deck, ['qr', 'url'], 'n'),
      setYamlIn(deck, ['cols'], '40/60'),
      setYamlIn(deck, ['opts', 'c'], 3),
      setYamlIn(deck, ['dragPos'], { img: '1,2,3,4' }),
    ]).toEqual([
      deck.replace('  skipSlides: [1]\n', '  skipSlides: [1]\n  url: n\n'),
      `${deck}\ncols: 40/60`,
      deck.replace('opts: {a: 1, b: 2}', 'opts: {a: 1, b: 2, c: 3}'),
      `${deck}\ndragPos:\n  img: 1,2,3,4`,
    ])
  })

  it('adds the first key to empty YAML', () => {
    expect(setYamlIn('', ['cols'], '40/60')).toBe('cols: 40/60')
  })
})

describe('deleteYamlIn', () => {
  it('removes a key with its value lines', () => {
    expect([
      deleteYamlIn(deck, ['publish']),
      deleteYamlIn(deck, ['qr', 'size']),
      deleteYamlIn(deck, ['opts', 'a']),
      deleteYamlIn(deck, ['nope']),
    ]).toEqual([
      deck.replace('publish:\n  baseUrl: https://disky-deep-dive.oa.dev   # `BASE_URL=… pnpm build` overrides\n', ''),
      deck.replace('  size: 56\n', ''),
      deck.replace('opts: {a: 1, b: 2}', 'opts: {b: 2}'),
      deck,
    ])
  })
})

describe('patchYaml', () => {
  it('patches an object onto a map key by key, touching only what changed', () => {
    expect(patchYaml(deck, { qr: { position: 'br', size: 56, skipSlides: [1], url: 'n' } }))
      .toBe(deck.replace('  skipSlides: [1]\n', '  skipSlides: [1]\n  url: n\n'))
    expect(patchYaml(deck, { qr: { position: 'br', skipSlides: [1] }, info: null, cols: '40/60' }))
      .toBe(deck.replace('  size: 56\n', '').replace('info: Managing fleet disk usage', 'cols: 40/60'))
  })

  it('leaves the text byte-identical when nothing changes', () => {
    expect(patchYaml(deck, { qr: { position: 'br', size: 56, skipSlides: [1] }, theme: 'open-athena' })).toBe(deck)
  })
})
