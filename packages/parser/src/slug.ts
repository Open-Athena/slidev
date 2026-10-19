// Slide slugs (`/<n>-<slug>` URLs, per-slide pages and share cards), shared by the client and the
// build so both derive the same one.

const SLUG_MAX = 80

/**
 * A markdown title's visible text: link text without its target, no images or HTML tags, entities
 * as spaces. Emphasis and code markers are left for `slugify` (they're punctuation to it).
 */
export function titleText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, ' ')
}

/** Lowercase ASCII words joined by `-`, at most 80 characters, cut at a word boundary. */
export function slugify(s: string | undefined | null): string {
  const slug = words(s)
  if (slug.length <= SLUG_MAX)
    return slug
  const cut = slug.slice(0, SLUG_MAX + 1)
  const end = cut.lastIndexOf('-')
  return end > 0 ? cut.slice(0, end) : slug.slice(0, SLUG_MAX)
}

function words(s: string | undefined | null): string {
  return (s ?? '')
    .normalize('NFKD')
    // Combining marks, after NFKD decomposition: "é" → "e" + "́" → "e".
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// The slug rule before titles were reduced to their text: the raw markdown, cut at 80 characters.
function legacySlugify(s: string): string {
  return words(s).slice(0, SLUG_MAX)
}

export interface SlideSlugs {
  /** The slide's slug: frontmatter `slug`, else `routeAlias`, else its title's text; `''` if none. */
  slug: string
  /**
   * Other slugs that still name the slide: frontmatter `aliases`, its old slugs the dev server
   * recorded (`slugHistory`, from `slides.slugs.yaml`), and the slug the previous rule derived
   * from a markdown title, so links already shared keep working.
   */
  aliases: string[]
}

export function slideSlugs(frontmatter: Record<string, any> | undefined, title: string | undefined): SlideSlugs {
  const fm = frontmatter ?? {}
  const sources = [fm.slug, fm.routeAlias, fm.title, title]
  const source = sources.find(s => typeof s === 'string' && slugify(titleText(s))) as string | undefined
  const slug = source ? slugify(titleText(source)) : ''
  const list = (v: unknown): unknown[] => Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
  const listed = [...list(fm.aliases), ...list(fm.slugHistory)]
  const aliases = [
    ...listed.filter((a: unknown): a is string => typeof a === 'string').map(a => slugify(a)),
    source ? legacySlugify(source) : '',
  ].filter((a, i, all) => a && a !== slug && all.indexOf(a) === i)
  return { slug, aliases }
}
