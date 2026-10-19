import { describe, expect, it } from 'vitest'
import { slideSlugs, slugify, titleText } from '../packages/parser/src/slug'

const slugOfTitle = (title: string) => slideSlugs({}, title).slug

describe('slugs come from a title\'s visible text', () => {
  it('a link: its text, not its target', () => {
    expect(slugOfTitle('[`@open-athena/treemap`](https://www.npmjs.com/package/@open-athena/treemap): our own treemap'))
      .toBe('open-athena-treemap-our-own-treemap')
  })

  it('inline code, emphasis', () => {
    expect(slugOfTitle('The `slidev deploy` command')).toBe('the-slidev-deploy-command')
    expect(slugOfTitle('**Bold**, *italic* and ~~gone~~ words')).toBe('bold-italic-and-gone-words')
  })

  it('hTML tags and images give no text', () => {
    expect(slugOfTitle('<img src="/logo.svg" alt="Logo"> Disky')).toBe('disky')
    expect(slugOfTitle('![logo](/logo.svg) Disky &amp; friends')).toBe('disky-friends')
    expect(slugOfTitle('<span class="text-red">Hot</span> takes')).toBe('hot-takes')
  })

  it('emoji', () => {
    expect(slugOfTitle('🚀 Launch day 🎉')).toBe('launch-day')
  })

  it('underscores and accents', () => {
    expect(slugOfTitle('snake_case Résumé')).toBe('snake-case-resume')
  })

  it('a title with no text has no slug', () => {
    expect(slugOfTitle('<img src="/logo.svg">')).toBe('')
  })
})

describe('truncation', () => {
  it('cuts at a word boundary, at most 80 characters', () => {
    const long = 'Managing fleet disk usage across many buckets and projects without losing anything important at all'
    expect(slugify(long)).toBe('managing-fleet-disk-usage-across-many-buckets-and-projects-without-losing')
    expect(slugify(long).length).toBe(73)
  })

  it('a single overlong word is cut mid-word', () => {
    expect(slugify('x'.repeat(100))).toBe('x'.repeat(80))
  })
})

describe('slide slugs and aliases', () => {
  it('frontmatter `slug` wins, then `routeAlias`, then frontmatter `title`, then the heading', () => {
    expect([
      slideSlugs({ slug: 'Custom Slug', routeAlias: 'alias', title: 'FM title' }, 'Heading'),
      slideSlugs({ routeAlias: 'alias', title: 'FM title' }, 'Heading'),
      slideSlugs({ title: 'FM title' }, 'Heading'),
      slideSlugs({}, 'Heading'),
      slideSlugs({}, undefined),
    ]).toEqual([
      { slug: 'custom-slug', aliases: [] },
      { slug: 'alias', aliases: [] },
      { slug: 'fm-title', aliases: [] },
      { slug: 'heading', aliases: [] },
      { slug: '', aliases: [] },
    ])
  })

  it('a markdown title keeps the slug the previous rule gave it, as an alias', () => {
    expect(slideSlugs({}, '[`@open-athena/treemap`](https://www.npmjs.com/package/@open-athena/treemap): our own treemap')).toEqual({
      slug: 'open-athena-treemap-our-own-treemap',
      aliases: ['open-athena-treemap-https-www-npmjs-com-package-open-athena-treemap-our-own-tree'],
    })
  })

  it('frontmatter `aliases` (a list or one string) are slugged; duplicates and the slug itself dropped', () => {
    expect(slideSlugs({ aliases: ['Old Name', 'old-name', 'Install'] }, 'Install')).toEqual({ slug: 'install', aliases: ['old-name'] })
    expect(slideSlugs({ aliases: 'Old Name' }, 'Install')).toEqual({ slug: 'install', aliases: ['old-name'] })
  })
})

describe('titleText', () => {
  it('keeps reference-link text', () => {
    expect(titleText('See [the docs][docs] now')).toBe('See the docs now')
  })
})
