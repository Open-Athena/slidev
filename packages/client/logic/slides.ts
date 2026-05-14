import type { SlideRoute } from '@slidev/types'
import { slides } from '#slidev/slides'
import { tryOnMounted } from '@vueuse/core'
import { computed, watch } from 'vue'
import { useSlideContext } from '../context'
import { configs } from '../env'

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
  // readable + per-slide OG pre-renders resolve cleanly.
  const alias = route.meta.slide?.frontmatter.routeAlias
  if (presenter)
    return `/presenter/${alias ?? route.no}`
  if (exporting)
    return `/export/${alias ?? route.no}`
  if (alias)
    return `/${alias}`
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
