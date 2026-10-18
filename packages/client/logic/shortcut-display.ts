import { shallowReactive } from 'vue'

// How each named shortcut is written for people (`toggle_overview` → `o`, `` ` ``), for tooltips.
// Filled from the same places that bind the keys: `ShortcutOptions.display` in the shortcut table
// (`setup/shortcuts.ts`, including user setups) and the hard-coded strokes in `logic/shortcuts.ts`.
const displays = shallowReactive(new Map<string, string[]>())

export function registerShortcutDisplay(name: string, display: string[]): void {
  displays.set(name, display)
}

/** The key combinations for one or more shortcut names, in order, without duplicates. */
export function formatShortcut(names: string | string[] | undefined): string[] {
  const out: string[] = []
  for (const name of typeof names === 'string' ? [names] : names ?? []) {
    for (const combo of displays.get(name) ?? []) {
      if (!out.includes(combo))
        out.push(combo)
    }
  }
  return out
}
