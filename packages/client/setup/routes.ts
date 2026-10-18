import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'
import configs from '#slidev/configs'
import setups from '#slidev/setups/routes'
import { getSlide, slugForSlide } from '../logic/slides'

export default function setupRoutes() {
  const routes: RouteRecordRaw[] = []

  function passwordGuard(to: RouteLocationNormalized) {
    if (!configs.remote || configs.remote === to.query.password)
      return true
    if (configs.remote && to.query.password === undefined) {
      // eslint-disable-next-line no-alert
      const password = prompt('Enter password')
      if (configs.remote === password)
        return true
    }
    if (to.params.no)
      return { path: `/${to.params.no}` }
    return { path: '' }
  }

  if (__SLIDEV_FEATURE_PRESENTER__) {
    routes.push(
      {
        name: 'entry',
        path: '/entry',
        component: () => import('../pages/entry.vue'),
        beforeEnter: passwordGuard,
      },
      {
        name: 'overview',
        path: '/overview',
        component: () => import('../pages/overview.vue'),
        beforeEnter: passwordGuard,
      },
      {
        name: 'notes',
        path: '/notes',
        component: () => import('../pages/notes.vue'),
        beforeEnter: passwordGuard,
      },
      {
        name: 'notes-edit',
        path: '/notes-edit',
        component: () => import('../pages/notes-edit.vue'),
        beforeEnter: passwordGuard,
      },
      {
        name: 'presenter',
        path: '/presenter/:no',
        component: () => import('../pages/presenter.vue'),
        beforeEnter: passwordGuard,
      },
      {
        path: '/presenter',
        redirect: { path: '/presenter/1' },
      },
    )
  }

  if (__SLIDEV_FEATURE_PRINT__) {
    routes.push(
      {
        name: 'print',
        path: '/print',
        component: () => import('../pages/print.vue'),
        beforeEnter: passwordGuard,
      },
      {
        path: '/presenter/print',
        component: () => import('../pages/presenter/print.vue'),
        beforeEnter: passwordGuard,
      },
    )
  }

  if (__SLIDEV_FEATURE_BROWSER_EXPORTER__) {
    routes.push(
      {
        name: 'export',
        path: '/export/:no?',
        component: () => import('../pages/export.vue'),
        beforeEnter: passwordGuard,
      },
    )
  }

  routes.push(
    {
      // Canonical `/<n>-<slug>` form (e.g. `/3-install`). The slug param is
      // decorative — play.vue resolves by `:no`. We accept any slug here (don't
      // verify it matches the current slug) so renaming a slug doesn't break
      // existing shared links: stale `/3-old-slug` URLs still land on slide 3.
      name: 'play-slug',
      path: '/:no(\\d+)-:slug([a-z0-9][a-z0-9-]*)',
      component: () => import('../pages/play.vue'),
    },
    {
      name: 'play',
      // Constrain `:no` to digits only — otherwise any single-segment path
      // (e.g. `/_og`) matches and `play.vue` silently falls back to slide 1.
      // Non-numeric paths now fall through to the slug-only / NotFound routes.
      path: '/:no(\\d+)',
      component: () => import('../pages/play.vue'),
    },
    {
      path: '',
      redirect: { path: '/1' },
    },
    {
      // Bare slug — resolve via the slide list (matches `frontmatter.slug`,
      // `routeAlias`, or slugified title) and redirect to the canonical
      // `/<n>-<slug>` form. Falls through to NotFound when no slide matches.
      path: '/:slug([a-z][a-z0-9-]*)',
      redirect: (to) => {
        const slug = String(to.params.slug)
        const slide = getSlide(slug)
        if (!slide)
          return { name: 'NotFound', params: { pathMatch: [slug] } }
        const canonicalSlug = slugForSlide(slide) || slug
        return { path: `/${slide.no}-${canonicalSlug}` }
      },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('../pages/404.vue'),
    },
  )

  return setups.reduce((routes, setup) => setup(routes), routes)
}
