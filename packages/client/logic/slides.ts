import type { SlideRoute } from '@slidev/types'
import { slides } from '#slidev/slides'
import { tryOnMounted } from '@vueuse/core'
import { computed, watch } from 'vue'
import { useSlideContext } from '../context'

export { slides }

// Slug derivation mirrors `og.ts:pickSlug` (server side) so canonical URLs match
// the pre-rendered `dist/<n>-<slug>.html` shells. Kept tiny so client + server
// stay in sync without an extra shared module — if the server-side rule changes,
// this needs to follow.
const SLUG_PUNCT_RE = /[^\w\s-]+/g
const SLUG_SPACE_RE = /[\s_-]+/g
const SLUG_TRIM_RE = /^-+|-+$/g

export function slugify(s: string | undefined | null): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(SLUG_PUNCT_RE, ' ')
    .replace(SLUG_SPACE_RE, '-')
    .replace(SLUG_TRIM_RE, '')
    .slice(0, 80)
}

export function slugForSlide(route: SlideRoute | undefined | null): string {
  if (!route)
    return ''
  const fm = route.meta.slide?.frontmatter ?? {}
  const title = route.meta.slide?.title
  return (
    (typeof fm.slug === 'string' && slugify(fm.slug))
    || (typeof fm.routeAlias === 'string' && slugify(fm.routeAlias))
    || (typeof fm.title === 'string' && slugify(fm.title))
    || (typeof title === 'string' && slugify(title))
    || ''
  )
}

export function getSlide(noOrSlug: number | string) {
  const target = String(noOrSlug)
  return slides.value.find((s) => {
    if (s.no === +noOrSlug)
      return true
    if (s.meta.slide?.frontmatter.routeAlias === noOrSlug)
      return true
    return slugForSlide(s) === target
  })
}

export function getSlidePath(
  route: SlideRoute | number | string,
  presenter: boolean,
  exporting: boolean = false,
) {
  if (typeof route === 'number' || typeof route === 'string')
    route = getSlide(route)!
  // `routeAlias` is the legacy upstream knob (kept working for compatibility);
  // when both `routeAlias` and `slug` (auto-derived) exist, presenter / export
  // routes use the alias verbatim, but the public slide URL prefers the canonical
  // `<n>-<slug>` form so shared links stay readable + per-slide OG pre-renders
  // resolve cleanly.
  const alias = route.meta.slide?.frontmatter.routeAlias
  if (presenter)
    return `/presenter/${alias ?? route.no}`
  if (exporting)
    return `/export/${alias ?? route.no}`
  if (alias)
    return `/${alias}`
  const slug = slugForSlide(route)
  return slug ? `/${route.no}-${slug}` : `/${route.no}`
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
