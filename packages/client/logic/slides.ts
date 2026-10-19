import type { SlideRoute } from '@slidev/types'
import { slideSlugs, slugify } from '@slidev/parser/utils'
import { tryOnMounted } from '@vueuse/core'
import { computed, watch } from 'vue'
import { slides } from '#slidev/slides'
import { useSlideContext } from '../context'
import { configs } from '../env'
import { getSlideRoutePath } from './slidePath'

export { slides }

// Slugs come from `@slidev/parser/utils` (`slideSlugs`), which the build uses too, so canonical
// URLs match the pre-rendered `dist/<n>-<slug>.html` pages.
export { slugify }

function slugsOf(route: SlideRoute | undefined | null) {
  return slideSlugs(route?.meta.slide?.frontmatter, route?.meta.slide?.title)
}

export function slugForSlide(route: SlideRoute | undefined | null): string {
  return route ? slugsOf(route).slug : ''
}

/** Old slugs that still name the slide (frontmatter `aliases`, the pre-text-title slug). */
export function slugAliasesForSlide(route: SlideRoute | undefined | null): string[] {
  return route ? slugsOf(route).aliases : []
}

export function getSlide(noOrSlug: number | string) {
  const target = String(noOrSlug)
  return slides.value.find((s) => {
    if (s.no === +noOrSlug)
      return true
    if (s.meta.slide?.frontmatter.routeAlias === noOrSlug)
      return true
    return slugForSlide(s) === target
  }) ?? onlyOne(slides.value.filter(s => slugAliasesForSlide(s).includes(target)))
}

function onlyOne<T>(items: T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined
}

// Mirrors `og.ts:canonicalPathFor` (server side) so the URL bar after in-deck
// nav stays in sync with the canonical form stamped into `<link rel=canonical>`
// at build time.
function canonicalPathFor(no: number, slug: string, form: 'n' | 'n-slug' | 'slug'): string {
  switch (form) {
    case 'n': return String(no)
    case 'slug': return slug || String(no)
    case 'n-slug':
    default: return slug ? `${no}-${slug}` : String(no)
  }
}

export function getSlidePath(
  route: SlideRoute | number | string,
  presenter: boolean,
  exporting: boolean = false,
) {
  if (typeof route === 'number' || typeof route === 'string')
    route = getSlide(route)!
  // `routeAlias` is the legacy upstream knob (kept working for compatibility);
  // presenter / export routes use the alias verbatim, but the public slide URL
  // follows `publish.canonicalForm` (default `n-slug`) so shared links stay
  // readable + per-slide OG pre-renders resolve cleanly. Paths are relative to the
  // router base (upstream #2630); callers building absolute URLs add `BASE_URL`.
  if (presenter || exporting || route.meta.slide?.frontmatter.routeAlias)
    return getSlideRoutePath(route, presenter, exporting)
  const form = (configs.publish as any)?.canonicalForm
  const resolved: 'n' | 'n-slug' | 'slug' = (form === 'n' || form === 'slug') ? form : 'n-slug'
  return `/${canonicalPathFor(route.no, slugForSlide(route), resolved)}`
}

export function useIsSlideActive() {
  const { $page, $nav } = useSlideContext()
  // Use `$nav.value.currentSlideNo` rather than `useNav().currentSlideNo` to make it work in print/export mode. See https://github.com/slidevjs/slidev/issues/2310.
  return computed(() => $page.value === $nav.value.currentSlideNo)
}

export function onSlideEnter(cb: (to: number, from: number | undefined) => any) {
  const { $page, $nav } = useSlideContext()

  tryOnMounted(() => {
    watch(() => $nav.value.currentSlideNo, (to, from) => {
      if ($page.value === to)
        cb(to, from)
    }, { immediate: true })
  })
}

export function onSlideLeave(cb: (to: number, from: number | undefined) => any) {
  const { $page, $nav } = useSlideContext()

  tryOnMounted(() => {
    watch(() => $nav.value.currentSlideNo, (to, from) => {
      if ($page.value === from)
        cb(to, from)
    })
  })
}
