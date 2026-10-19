import { describe, expect, it } from 'vitest'
import { parse, prettifySlide, stringify } from '../packages/parser/src/core'
import { updateFrontmatterPatch } from '../packages/slidev/node/utils'

const lines = (...l: string[]) => l.join('\n')

const deck = lines(
  '---',
  'theme: open-athena',
  'title: "Deep Dive: Disky & Friends"',
  // Longer than the 80 columns YAML serializers fold at.
  'description: A fork of sli.dev that adds direct manipulation — click any image to drag, resize, rotate, reorder, or crop.',
  'draggableImageTags: [Scrn]',
  'publish:',
  '  baseUrl: https://disky-deep-dive.oa.dev   # `BASE_URL=… pnpm build` overrides',
  'qr:',
  '  position: br',
  '  size: 56',
  '  skipSlides: [1]',
  'info: Managing fleet disk usage — Ryan Williams',
  '---',
  '',
  '# Disky',
  '',
)

async function edit(patch?: Record<string, any>, content?: string) {
  const md = await parse(deck, 'slides.md')
  const slide = md.slides[0]
  if (patch)
    updateFrontmatterPatch(slide, patch)
  if (content)
    slide.content = content
  prettifySlide(slide)
  return stringify(md)
}

describe('frontmatter writes change only the touched key', () => {
  it('adds a nested key as one line, keeping flow lists, quoting and comment spacing', async () => {
    expect(await edit({ qr: { position: 'br', size: 56, skipSlides: [1], url: 'n' } })).toBe(
      deck.replace('  skipSlides: [1]\n', '  skipSlides: [1]\n  url: n\n'),
    )
  })

  it('changes a value in place', async () => {
    expect(await edit({ qr: { position: 'tr', size: 56, skipSlides: [1] } })).toBe(deck.replace('  position: br\n', '  position: tr\n'))
  })

  it('adds and removes top-level keys as single lines', async () => {
    expect(await edit({ cols: '40/60', info: null })).toBe(
      deck.replace('info: Managing fleet disk usage — Ryan Williams\n', 'cols: 40/60\n'),
    )
  })

  it('leaves the frontmatter byte-identical when only the content changes', async () => {
    expect(await edit(undefined, '\n# Disky, edited\n')).toBe(deck.replace('# Disky\n', '# Disky, edited\n'))
  })
})
