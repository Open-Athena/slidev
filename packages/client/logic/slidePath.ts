import type { SlideRoute } from '@slidev/types'

export function getSlideRoutePath(
  route: SlideRoute,
  presenter: boolean,
  exporting: boolean = false,
) {
  const no = route.meta.slide?.frontmatter.routeAlias ?? route.no
  return exporting ? `/export/${no}` : presenter ? `/presenter/${no}` : `/${no}`
}

/**
 * The slide a `/<n>-<slug>` URL means. Slide numbers shift when slides are inserted or removed
 * before it, but slugs don't, so a slug that names exactly one slide wins: a slide's own slug
 * first, else one of its aliases (old slugs). Otherwise (an unknown or ambiguous slug) the number
 * does.
 */
export function resolveNumberedSlug<T extends { no: number }>(
  no: number,
  slug: string,
  slides: T[],
  slugOf: (s: T) => string,
  aliasesOf: (s: T) => string[] = () => [],
): number {
  for (const names of [(s: T) => slugOf(s) === slug, (s: T) => aliasesOf(s).includes(slug)]) {
    const matches = slides.filter(names)
    if (matches.length)
      return matches.length === 1 ? matches[0].no : no
  }
  return no
}
