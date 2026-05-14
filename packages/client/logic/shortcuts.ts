import type { ShortcutOptions } from '@slidev/types'
import type { Fn, KeyFilter } from '@vueuse/core'
import type { Ref } from 'vue'
import { onKeyDown, onKeyStroke } from '@vueuse/core'
import { and, not } from '@vueuse/math'
import { watch } from 'vue'
import { redo as historyRedo, undo as historyUndo } from '../composables/useDragHistory'
import { useNav } from '../composables/useNav'
import { configs } from '../env'
import { getSlidePath } from '../logic/slides'
import setupShortcuts from '../setup/shortcuts'
import { fullscreen, isInputting, isOnFocus, magicKeys, shortcutsEnabled, shortcutsLocked, showHistoryDrawer } from '../state'

export function registerShortcuts() {
  const { isPrintMode, currentSlideRoute } = useNav()
  const enabled = and(not(isInputting), not(isOnFocus), not(isPrintMode), shortcutsEnabled, not(shortcutsLocked))

  const allShortcuts = setupShortcuts()
  const shortcuts = new Map<string | Ref<boolean>, ShortcutOptions>(
    allShortcuts.map((options: ShortcutOptions) => [options.key, options]),
  )

  shortcuts.forEach((options) => {
    if (options.fn)
      shortcut(options.key, options.fn, options.autoRepeat)
  })

  strokeShortcut('f', () => fullscreen.toggle())
  strokeShortcut('h', () => showHistoryDrawer.value = !showHistoryDrawer.value)
  // `y` = yank: copy current slide's canonical share URL to clipboard. Uses the
  // deck's `publish.baseUrl` when set (production share URL); falls back to
  // `location.origin` so it still works locally / when baseUrl isn't configured.
  strokeShortcut('y', () => {
    const route = currentSlideRoute.value
    if (!route)
      return
    const path = getSlidePath(route, false, false)
    const base = (configs.publish as any)?.baseUrl?.replace?.(/\/+$/, '') ?? (typeof location !== 'undefined' ? location.origin : '')
    const url = `${base}${path}`
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(url)
    }
  })

  // Global undo / redo for v-drag edits — operates on the deck-global stack so it works
  // whether or not an element is selected, and whether or not its slide is current.
  onKeyDown('z', (e) => {
    if (!enabled.value)
      return
    if (!e.metaKey && !e.ctrlKey)
      return
    e.preventDefault()
    if (e.shiftKey)
      void historyRedo()
    else
      void historyUndo()
  })

  function shortcut(key: string | Ref<boolean>, fn: Fn, autoRepeat = false) {
    if (typeof key === 'string')
      key = magicKeys[key]

    const source = and(key, enabled)
    let count = 0
    let timer: any
    const trigger = () => {
      clearTimeout(timer)
      if (!source.value) {
        count = 0
        return
      }
      if (autoRepeat) {
        timer = setTimeout(trigger, Math.max(1000 - count * 250, 150))
        count++
      }
      fn()
    }

    return watch(source, trigger, { flush: 'sync' })
  }

  function strokeShortcut(key: KeyFilter, fn: Fn) {
    return onKeyStroke(key, (ev) => {
      if (!enabled.value)
        return
      if (!ev.repeat)
        fn()
    })
  }
}
