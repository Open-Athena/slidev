import type { NavOperations, ShortcutOptions } from '@slidev/types'
import { and, not, or } from '@vueuse/math'
import setups from '#slidev/setups/shortcuts'
import { useDrawings } from '../composables/useDrawings'
import { hasSelection } from '../composables/useMultiSelect'
import { useNav } from '../composables/useNav'
import { toggleSlidesDrawer } from '../composables/useSlidesDrawer'
import { toggleDark } from '../logic/dark'
import { editMode, magicKeys, showGotoDialog, showInsertImageDialog, showOverview, toggleOverview } from '../state'
import { downloadPDF } from '../utils'
import { currentOverviewPage, downOverviewPage, nextOverviewPage, prevOverviewPage, upOverviewPage } from './../logic/overview'

export default function setupShortcuts() {
  const { go, goFirst, goLast, next, nextSlide, prev, prevSlide } = useNav()
  const { drawingEnabled } = useDrawings()
  const { escape, space, shift, left, right, up, down, enter, d, e, g, i, o, t, '`': backtick } = magicKeys

  const context: NavOperations = {
    next,
    prev,
    nextSlide,
    prevSlide,
    go,
    goFirst,
    goLast,
    downloadPDF,
    toggleDark,
    toggleOverview,
    toggleDrawing: () => drawingEnabled.value = !drawingEnabled.value,
    escapeOverview: () => showOverview.value = false,
    showGotoDialog: () => showGotoDialog.value = !showGotoDialog.value,
  }

  const navViaArrowKeys = and(not(showOverview), not(hasSelection))

  let shortcuts: ShortcutOptions[] = [
    { name: 'next_space', key: and(space, not(shift)), display: ['space'], fn: next, autoRepeat: true },
    { name: 'prev_space', key: and(space, shift), display: ['⇧ space'], fn: prev, autoRepeat: true },
    { name: 'next_right', key: and(right, not(shift), navViaArrowKeys), display: ['→'], fn: next, autoRepeat: true },
    { name: 'prev_left', key: and(left, not(shift), navViaArrowKeys), display: ['←'], fn: prev, autoRepeat: true },
    { name: 'next_page_key', key: 'pageDown', display: ['page down'], fn: next, autoRepeat: true },
    { name: 'prev_page_key', key: 'pageUp', display: ['page up'], fn: prev, autoRepeat: true },
    { name: 'next_down', key: and(down, navViaArrowKeys), display: ['↓'], fn: nextSlide, autoRepeat: true },
    { name: 'prev_up', key: and(up, navViaArrowKeys), display: ['↑'], fn: prevSlide, autoRepeat: true },
    { name: 'next_shift', key: and(right, shift), display: ['⇧ →'], fn: nextSlide, autoRepeat: true },
    { name: 'prev_shift', key: and(left, shift), display: ['⇧ ←'], fn: prevSlide, autoRepeat: true },
    { name: 'toggle_dark', key: and(d, not(drawingEnabled)), display: ['d'], fn: toggleDark },
    { name: 'toggle_overview', key: and(or(o, backtick), not(drawingEnabled)), display: ['o', '`'], fn: toggleOverview },
    { name: 'hide_overview', key: and(escape, not(drawingEnabled)), display: ['esc'], fn: () => showOverview.value = false },
    { name: 'goto', key: and(g, not(drawingEnabled)), display: ['g'], fn: () => showGotoDialog.value = !showGotoDialog.value },
    { name: 'toggle_slides_drawer', key: and(t, shift, not(drawingEnabled)), display: ['⇧T'], fn: () => toggleSlidesDrawer(undefined, { focus: true }) },
    { name: 'toggle_edit', key: and(e, not(drawingEnabled)), display: ['e'], fn: () => editMode.value = !editMode.value },
    { name: 'insert_image', key: and(i, not(drawingEnabled), editMode), display: ['i'], fn: () => showInsertImageDialog.value = !showInsertImageDialog.value },
    { name: 'next_overview', key: and(right, showOverview), fn: nextOverviewPage },
    { name: 'prev_overview', key: and(left, showOverview), fn: prevOverviewPage },
    { name: 'up_overview', key: and(up, showOverview), fn: upOverviewPage },
    { name: 'down_overview', key: and(down, showOverview), fn: downOverviewPage },
    {
      name: 'goto_from_overview',
      key: and(enter, showOverview),
      fn: () => {
        go(currentOverviewPage.value)
        showOverview.value = false
      },
    },
  ]

  const baseShortcutNames = new Set(shortcuts.map(s => s.name))

  for (const setup of setups) {
    shortcuts = setup(context, shortcuts)
  }

  const remainingBaseShortcutNames = shortcuts.filter(s => s.name && baseShortcutNames.has(s.name))
  if (remainingBaseShortcutNames.length === 0) {
    const message = [
      '========== WARNING ==========',
      'defineShortcutsSetup did not return any of the base shortcuts.',
      'See https://sli.dev/custom/config-shortcuts.html for migration.',
      'If it is intentional, return at least one shortcut with one of the base names (e.g. name:"goto").',
    ].join('\n\n')
    // eslint-disable-next-line no-alert
    alert(message)

    console.warn(message)
  }

  return shortcuts
}
