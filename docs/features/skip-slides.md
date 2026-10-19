---
relates:
  - features/draggable
tags: [navigation, presenter]
description: |
  Mark slides to skip while presenting; they stay in the deck, and one toggle shows them again.
---

# Skipping Slides

`hide: true` (or `disabled: true`) removes a slide from the build, renumbering everything after it. To keep a slide in the deck but pass over it when presenting, mark it `skip: true`:

```md
---
skip: true
---

# Backup slide
```

While **skip skipped slides** is on (the default), next / previous (keys, clicks, swipes, the presenter's buttons) step over skipped slides, and the presenter's next-slide preview shows the next one that isn't skipped. A skipped slide is still reachable directly: with `g`, the overview, the slides drawer or its URL. While one is shown, the navigation bar marks it **skipped**.

Slide numbers don't change: URLs, QR codes and share cards stay the same, and the counter reads e.g. `14 / 50 · 3 skipped`.

## Toggling

Press `⇧S`, or click <carbon-skip-forward-filled class="inline-icon-btn"/> in the navigation bar or the slides drawer (`⇧T`), or use the right-click menu. The setting works the same in play mode, presenter mode and plain browsing, is remembered per browser, and is synced between the presenter and audience windows.

A deck can offer both in its own UI (e.g. a command palette): the toggle, and marking the current slide (`toggleSlideSkip(no)`, dev server only, in or out of edit mode; undoable):

```ts
import { isSlideSkipped, toggleSkipSkipped, toggleSlideSkip } from '@slidev/client/composables/useSlideSkip.ts'
import { skipSkipped } from '@slidev/client/state/index.ts'
```

## Marking slides

In the dev server's edit mode (`e`), click <carbon-skip-forward-outline class="inline-icon-btn"/> in the navigation bar to mark or unmark the current slide, or use the skip button next to a slide in the overview (`o`) or the slides drawer, or the right-click menu. This writes the slide's `skip` frontmatter (one line), and `⌘Z` undoes it. Skipped slides are dimmed in the overview and the drawer.

## Exporting

`slidev export` leaves skipped slides out. Pass `--with-skipped` to include them.
