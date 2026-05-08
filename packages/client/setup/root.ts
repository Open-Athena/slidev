import setups from '#slidev/setups/root'
import { useHead } from '@unhead/vue'
import { computed, getCurrentInstance, reactive, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { createFixedClicks } from '../composables/useClicks'
import { connectStateStream, hydrateFromServer } from '../composables/useDragHistory'
import { useEmbeddedControl } from '../composables/useEmbeddedCtrl'
import { useNav } from '../composables/useNav'
import { usePrintStyles } from '../composables/usePrintStyles'
import { injectionClicksContext, injectionCurrentPage, injectionRenderContext, injectionSlidevContext, TRUST_ORIGINS } from '../constants'
import { configs, slidesTitle } from '../env'
import { getSlidePath } from '../logic/slides'
import { makeId } from '../logic/utils'
import { hmrSkipTransition, syncDirections } from '../state'
import { initDrawingState } from '../state/drawings'
import { initSharedState, onPatch, patch } from '../state/shared'

export default function setupRoot() {
  const app = getCurrentInstance()!.appContext.app

  const context = reactive({
    nav: useNav(),
    configs,
    themeConfigs: computed(() => configs.themeConfig),
  })
  app.provide(injectionRenderContext, ref('none' as const))
  app.provide(injectionSlidevContext, context)
  app.provide(injectionCurrentPage, computed(() => context.nav.currentSlideNo))
  app.provide(injectionClicksContext, shallowRef(createFixedClicks()))

  // allows controls from postMessages
  if (__DEV__) {
    // @ts-expect-error expose global
    window.__slidev__ = context
    useEmbeddedControl()
  }

  // User Setups
  for (const setup of setups)
    setup()

  const {
    clicksContext,
    currentSlideNo,
    hasPrimarySlide,
    isNotesViewer,
    isPresenter,
    isPrintMode,
  } = useNav()

  useHead({
    title: slidesTitle,
    htmlAttrs: configs.htmlAttrs,
  })

  usePrintStyles()

  initSharedState(`${slidesTitle} - shared`)
  initDrawingState(`${slidesTitle} - drawings`)

  // Cold-start fetch of drag-element state. The IStateClient probes `/__slidev/state` on
  // first call: in dev mode it returns the dev-server snapshot, in a static deploy it 404s
  // and we fall back to a localStorage-backed event log (LocalStateClient) so the visitor
  // can still drag, undo, restore, etc. Both backends populate `historyInitialState`,
  // which `useDragElement` watches to apply overrides onto live elements.
  void hydrateFromServer()
  // Subscribe to state-change broadcasts (SSE in dev, `storage` events in static mode)
  // so this tab learns about edits made elsewhere and applies them live.
  void connectStateStream()

  const id = `${location.origin}_${makeId()}`
  const syncType = computed(() => isPresenter.value ? 'presenter' : 'viewer')

  // update shared state
  function updateSharedState() {
    const shouldSend = isPresenter.value
      ? syncDirections.value.presenterSend
      : syncDirections.value.viewerSend

    if (!shouldSend)
      return
    if (isNotesViewer.value || isPrintMode.value)
      return
    // we allow Presenter mode, or Viewer mode from trusted origins to update the shared state
    if (!isPresenter.value && !TRUST_ORIGINS.includes(location.host.split(':')[0]))
      return

    patch('page', +currentSlideNo.value)
    patch('clicks', clicksContext.value.current)
    patch('clicksTotal', clicksContext.value.total)
    patch('lastUpdate', {
      id,
      type: syncType.value,
      time: Date.now(),
    })
  }
  const router = useRouter()
  router.afterEach(updateSharedState)
  watch(clicksContext, updateSharedState)

  onPatch((state) => {
    const shouldReceive = isPresenter.value
      ? syncDirections.value.presenterReceive
      : syncDirections.value.viewerReceive
    if (!shouldReceive)
      return
    if (!hasPrimarySlide.value || isPrintMode.value)
      return
    if (state.lastUpdate?.type === syncType.value)
      return
    if ((+state.page === +currentSlideNo.value && +clicksContext.value.current === +state.clicks))
      return
    // if (state.lastUpdate?.type === 'presenter') {
    hmrSkipTransition.value = false
    router.replace({
      path: getSlidePath(state.page, isPresenter.value),
      query: {
        ...router.currentRoute.value.query,
        clicks: state.clicks || 0,
      },
    })
    // }
  })
}
