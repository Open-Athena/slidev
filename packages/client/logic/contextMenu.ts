import type { ContextMenuItem } from '@slidev/types'
import type { ComputedRef } from 'vue'
import { shallowRef } from 'vue'
import { useNav } from '../composables/useNav'
import { configs, mode } from '../env'
import setupContextMenu from '../setup/context-menu'

export const currentContextMenu = shallowRef<null | {
  x: number
  y: number
  items: ComputedRef<ContextMenuItem[]>
}>(null)

export function openContextMenu(x: number, y: number) {
  currentContextMenu.value = {
    x,
    y,
    items: setupContextMenu(),
  }
}

export function closeContextMenu() {
  currentContextMenu.value = null
}

// Where the browser's own menu is the useful one: images and video (copy / open / save), links,
// text fields and editable text, and selected text. Media are looked for under the pointer at any
// depth, so it also works through overlays such as a selected draggable image's control box.
function wantsNativeMenu(ev: MouseEvent): boolean {
  const target = ev.target as Element | null
  if (target?.closest('a[href], input, textarea, [contenteditable="true"]'))
    return true
  if (getSelection()?.toString().trim())
    return true
  return document.elementsFromPoint(ev.clientX, ev.clientY).some(el => el.matches('img, video, picture, svg image'))
}

export function onContextMenu(ev: MouseEvent) {
  if (configs.contextMenu !== true && configs.contextMenu != null && configs.contextMenu !== mode)
    return
  if (ev.shiftKey || ev.defaultPrevented || wantsNativeMenu(ev))
    return

  const { isEmbedded } = useNav()
  if (isEmbedded.value)
    return

  openContextMenu(ev.pageX, ev.pageY)
  ev.preventDefault()
  ev.stopPropagation()
}
