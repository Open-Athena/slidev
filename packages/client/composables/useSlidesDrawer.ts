import { isClient } from '@vueuse/core'
import { reactive, ref, watch } from 'vue'

export type ThumbnailMode = 'text' | 'live'

/** The left-side slide index (`⇧T`), see `internals/SlidesDrawer.vue`. */
export interface SlidesDrawerState {
  visible: boolean
  width: number
  /** `text`: number + title per slide; `live`: rendered mini-previews (lazily mounted). */
  mode: ThumbnailMode
}

export const DRAWER_MIN_WIDTH = 120
export const DRAWER_MAX_WIDTH = 400
export const DRAWER_STORAGE_KEY = 'slidev-slides-drawer'

export const drawerDefaults: SlidesDrawerState = { visible: false, width: 200, mode: 'text' }

export function clampDrawerWidth(width: number): number {
  if (!Number.isFinite(width))
    return drawerDefaults.width
  return Math.round(Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, width)))
}

/** Parse the stored JSON, falling back to the defaults field by field for anything missing or malformed. */
export function parseDrawerState(raw: string | null): SlidesDrawerState {
  let stored: any = null
  try {
    stored = raw ? JSON.parse(raw) : null
  }
  catch {}
  if (!stored || typeof stored !== 'object')
    return { ...drawerDefaults }
  return {
    visible: typeof stored.visible === 'boolean' ? stored.visible : drawerDefaults.visible,
    width: typeof stored.width === 'number' ? clampDrawerWidth(stored.width) : drawerDefaults.width,
    mode: stored.mode === 'live' || stored.mode === 'text' ? stored.mode : drawerDefaults.mode,
  }
}

// Storage can be unavailable (private windows, blocked site data) or throw on access: the drawer
// then still works, it just isn't remembered.
function load(): SlidesDrawerState {
  try {
    return parseDrawerState(isClient ? window.localStorage.getItem(DRAWER_STORAGE_KEY) : null)
  }
  catch {
    return { ...drawerDefaults }
  }
}

export const slidesDrawer = reactive<SlidesDrawerState>(load())

if (isClient) {
  watch(slidesDrawer, (state) => {
    try {
      window.localStorage.setItem(DRAWER_STORAGE_KEY, JSON.stringify(state))
    }
    catch {}
  }, { deep: true })
}

/** Set when the drawer is opened from the keyboard, so it moves focus to the current slide's thumb. */
export const drawerFocusRequested = ref(false)

export function toggleSlidesDrawer(visible = !slidesDrawer.visible, { focus = false } = {}) {
  slidesDrawer.visible = visible
  drawerFocusRequested.value = visible && focus
}
