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
 * before it, but slugs don't, so a slug that names exactly one slide wins; otherwise (a renamed
 * or ambiguous slug) the number does.
 */
export function resolveNumberedSlug<T extends { no: number }>(no: number, slug: string, slides: T[], slugOf: (s: T) => string): number {
  const matches = slides.filter(s => slugOf(s) === slug)
  return matches.length === 1 ? matches[0].no : no
}
