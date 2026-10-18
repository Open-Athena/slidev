import { describe, expect, it } from 'vitest'
import {
  canonicalPathFor,
  firstParagraph,
  htmlEscape,
  joinUrl,
  pickSlug,
  pickTitle,
  slugify,
  stripMd,
} from '../packages/slidev/node/commands/og'

describe('slugify', () => {
  it('lower-cases and dashes spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('drops most punctuation', () => {
    expect(slugify('Foo! Bar? Baz.')).toBe('foo-bar-baz')
    expect(slugify('a/b/c')).toBe('a-b-c')
  })

  it('handles unicode by NFKD-decomposing combining marks', () => {
    expect(slugify('Résumé')).toBe('resume')
    expect(slugify('naïve')).toBe('naive')
    expect(slugify('Über')).toBe('uber')
  })

  it('preserves leading numerics', () => {
    expect(slugify('2024 Annual Review')).toBe('2024-annual-review')
  })

  it('collapses runs of separators (spaces, underscores, dashes)', () => {
    expect(slugify('a   b _ c-d')).toBe('a-b-c-d')
    expect(slugify('--a--b--')).toBe('a-b')
  })

  it('trims leading/trailing dashes', () => {
    expect(slugify('  foo  ')).toBe('foo')
    expect(slugify('!!!foo!!!')).toBe('foo')
  })

  it('returns empty string for empty/null/undefined', () => {
    expect(slugify('')).toBe('')
    expect(slugify(null as any)).toBe('')
    expect(slugify(undefined as any)).toBe('')
  })

  it('returns empty for all-punctuation inputs', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('...')).toBe('')
  })

  it('truncates at 80 chars', () => {
    const long = 'a'.repeat(200)
    expect(slugify(long)).toHaveLength(80)
  })
})

describe('canonicalPathFor', () => {
  it('"n" form ignores slug', () => {
    expect(canonicalPathFor(5, 'foo-bar', 'n')).toBe('5')
    expect(canonicalPathFor(5, '', 'n')).toBe('5')
  })

  it('"slug" form uses slug, degrades to n when empty', () => {
    expect(canonicalPathFor(5, 'foo-bar', 'slug')).toBe('foo-bar')
    expect(canonicalPathFor(5, '', 'slug')).toBe('5')
  })

  it('"n-slug" form joins with dash, degrades to n when empty', () => {
    expect(canonicalPathFor(5, 'foo-bar', 'n-slug')).toBe('5-foo-bar')
    expect(canonicalPathFor(5, '', 'n-slug')).toBe('5')
  })
})

describe('pickSlug', () => {
  // Minimal SlideInfo shape — only the fields pickSlug touches.
  const slide = (overrides: any) => overrides

  it('prefers frontmatter.slug over routeAlias', () => {
    expect(pickSlug(slide({ frontmatter: { slug: 'explicit', routeAlias: 'alias', title: 't' } }), 1)).toBe('explicit')
  })

  it('falls back to routeAlias when no slug', () => {
    expect(pickSlug(slide({ frontmatter: { routeAlias: 'my-alias', title: 't' } }), 1)).toBe('my-alias')
  })

  it('falls back to frontmatter.title when no slug/alias', () => {
    expect(pickSlug(slide({ frontmatter: { title: 'Hello World' } }), 1)).toBe('hello-world')
  })

  it('falls back to slide.title when no frontmatter title', () => {
    expect(pickSlug(slide({ frontmatter: {}, title: 'Slide One' }), 1)).toBe('slide-one')
  })

  it('uses slide-N as last-ditch fallback', () => {
    expect(pickSlug(slide({ frontmatter: {} }), 7)).toBe('slide-7')
  })

  it('slugifies the chosen source', () => {
    expect(pickSlug(slide({ frontmatter: { slug: 'A Fancy Title!!' } }), 1)).toBe('a-fancy-title')
  })

  it('falls through when slug field is non-string', () => {
    expect(pickSlug(slide({ frontmatter: { slug: 123, title: 'Title' } }), 1)).toBe('title')
  })

  it('falls through when slugifying yields empty', () => {
    expect(pickSlug(slide({ frontmatter: { slug: '!!!', title: 'Backup' } }), 1)).toBe('backup')
  })
})

describe('pickTitle', () => {
  const slide = (overrides: any) => overrides

  it('prefers frontmatter.title', () => {
    expect(pickTitle(slide({ frontmatter: { title: 'FM Title' }, title: 'Other' }), 'Deck', 1)).toBe('FM Title')
  })

  it('falls back to slide.title', () => {
    expect(pickTitle(slide({ frontmatter: {}, title: 'Slide Title' }), 'Deck', 1)).toBe('Slide Title')
  })

  it('falls back to "Deck — Slide N"', () => {
    expect(pickTitle(slide({ frontmatter: {} }), 'My Deck', 3)).toBe('My Deck — Slide 3')
  })

  it('ignores empty/whitespace titles', () => {
    expect(pickTitle(slide({ frontmatter: { title: '   ' }, title: '' }), 'Deck', 1)).toBe('Deck — Slide 1')
  })
})

describe('stripMd', () => {
  it('strips link syntax keeping anchor text', () => {
    expect(stripMd('Demo: [foo.bar](https://foo.bar)')).toBe('Demo: foo.bar')
  })

  it('strips bold and italic markers', () => {
    expect(stripMd('**bold** and *italic*')).toBe('bold and italic')
  })

  it('strips inline code', () => {
    expect(stripMd('use `npm install`')).toBe('use npm install')
  })

  it('collapses whitespace', () => {
    expect(stripMd('a    b\n\nc')).toBe('a b c')
  })

  it('trims edges', () => {
    expect(stripMd('   hello  ')).toBe('hello')
  })
})

describe('firstParagraph', () => {
  it('returns first non-heading paragraph', () => {
    const md = `# Title\n\nFirst paragraph here.\n\nSecond paragraph.`
    expect(firstParagraph(md)).toBe('First paragraph here.')
  })

  it('strips fenced code blocks', () => {
    const md = '```\ncode here\n```\n\nReal text after code.'
    expect(firstParagraph(md)).toBe('Real text after code.')
  })

  it('strips style and script blocks', () => {
    const md = '<style>p { color: red }</style>\n\nDescription text.'
    expect(firstParagraph(md)).toBe('Description text.')
  })

  it('strips Vue/HTML components', () => {
    const md = '<Tweet id="123" />\n\nThe paragraph.'
    expect(firstParagraph(md)).toBe('The paragraph.')
  })

  it('skips bullet lists and blockquotes', () => {
    const md = '- bullet\n> quote\n\nActual paragraph.'
    expect(firstParagraph(md)).toBe('Actual paragraph.')
  })

  it('strips markdown link syntax in body', () => {
    expect(firstParagraph('See [docs](https://example.com) for more.')).toBe('See docs for more.')
  })

  it('strips bold/italic/inline-code in body', () => {
    expect(firstParagraph('**Bold** *italic* and `code`.')).toBe('Bold italic and code.')
  })

  it('truncates at 300 chars', () => {
    const long = `${'word '.repeat(100).trim()}.`
    expect(firstParagraph(long).length).toBeLessThanOrEqual(300)
  })

  it('returns empty for empty content', () => {
    expect(firstParagraph('')).toBe('')
    expect(firstParagraph(null as any)).toBe('')
  })

  it('returns empty for content with no real paragraph', () => {
    expect(firstParagraph('# Heading only')).toBe('')
    expect(firstParagraph('- bullet\n- bullet\n- bullet')).toBe('')
  })
})

describe('htmlEscape', () => {
  it('escapes <, >, &, ", \'', () => {
    expect(htmlEscape('<script>"alert"&\'go\'</script>')).toBe(
      '&lt;script&gt;&quot;alert&quot;&amp;&#39;go&#39;&lt;/script&gt;',
    )
  })

  it('leaves safe characters alone', () => {
    expect(htmlEscape('Hello World 123 !.,;')).toBe('Hello World 123 !.,;')
  })
})

describe('joinUrl', () => {
  it('joins with single slash between parts', () => {
    expect(joinUrl('https://x.com', 'foo')).toBe('https://x.com/foo')
    expect(joinUrl('https://x.com/', '/foo')).toBe('https://x.com/foo')
    expect(joinUrl('https://x.com/', 'foo')).toBe('https://x.com/foo')
    expect(joinUrl('https://x.com', '/foo')).toBe('https://x.com/foo')
  })

  it('strips multiple trailing slashes from base and leading from path', () => {
    expect(joinUrl('https://x.com////', '////foo')).toBe('https://x.com/foo')
  })

  it('handles empty path', () => {
    expect(joinUrl('https://x.com', '')).toBe('https://x.com/')
  })
})
