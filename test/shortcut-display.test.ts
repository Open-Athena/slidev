import { describe, expect, it } from 'vitest'
import { formatShortcut, registerShortcutDisplay } from '../packages/client/logic/shortcut-display'

describe('formatShortcut', () => {
  it('joins the key combinations of the named shortcuts, in order, without duplicates', () => {
    registerShortcutDisplay('next_right', ['→'])
    registerShortcutDisplay('next_space', ['space'])
    registerShortcutDisplay('also_right', ['→'])
    expect([
      formatShortcut('next_right'),
      formatShortcut(['next_right', 'next_space', 'also_right']),
      formatShortcut('unknown'),
      formatShortcut(undefined),
    ]).toEqual([['→'], ['→', 'space'], [], []])
  })

  it('follows rebinding: registering a name again replaces its keys', () => {
    registerShortcutDisplay('toggle_overview', ['o', '`'])
    registerShortcutDisplay('toggle_overview', ['v'])
    expect(formatShortcut('toggle_overview')).toEqual(['v'])
  })
})
