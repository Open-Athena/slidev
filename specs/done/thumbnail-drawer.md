# Thumbnail Drawer Spec

Persistent left-side drawer of slide thumbnails — macOS Preview's PDF sidebar,
applied to Slidev. A presenter-facing navigation affordance that complements
the existing `QuickOverview` (`o` keypress, modal grid).

## Motivation

`QuickOverview` is a fullscreen modal: useful for "jump to any slide" during
editing, but disruptive mid-presentation. During a talk or while authoring, a
compact persistent index is often more useful:

- **While editing**: see structure at a glance; click to jump; no context loss
- **While presenting** (not in speaker mode): a peripheral "where am I in the
  deck" reference without covering the current slide
- **For long decks**: the `o` grid scales poorly past ~30 slides; a vertical
  scrollable list handles hundreds cleanly

This also closes a gap against other deck tools (Keynote, PowerPoint, Beamer's
`\tableofcontents`) that offer persistent outline views. Pitched as an
*optional* UI panel, off by default, with a toggle.

## Non-goals

- **Not a presenter-view replacement.** Speaker mode (`s`/`/presenter`) stays
  unchanged; it has its own "next slide" preview and notes.
- **Not a replacement for `QuickOverview`.** `o` remains the quick full-grid
  jump. The drawer is the always-available complement.
- **Not a slide editor.** Clicking a thumb navigates; editing still happens in
  the source markdown or the existing editor panel.

## UX

### Layout

```
┌───────────┬────────────────────────────────────┐
│           │                                    │
│  [thumb]  │                                    │
│  [thumb]  │         current slide              │
│  [thumb●] │                                    │
│  [thumb]  │                                    │
│  ...      │                                    │
│           │                                    │
└───────────┴────────────────────────────────────┘
   drawer               viewport
```

- Fixed left panel, default width ~200px (resizable, persisted).
- Main slide area shifts right to accommodate; does not overlap.
- Each thumbnail: slide index, small rendered preview, optional title.
- Current slide marked (colored border + background; `aria-current`).
- Clicking a thumb: navigates to that slide (same action as `Goto` or direct
  URL change).

### Thumbnail content

Two quality tiers:

1. **Text-only** (cheap): index + title from frontmatter / first heading.
   Enough for authoring; no render cost.
2. **Live mini-preview** (richer): each thumbnail is the actual slide's DOM
   scaled to ~160px wide via CSS `transform: scale()`.
   - Pro: always in sync with edits, clickable accessibility tree, no export
     step.
   - Con: mounting all slides simultaneously is expensive — need virtualization
     (only render thumbs in/near the viewport) and/or lazy mount (render a
     thumb when the user scrolls it into the drawer).

Ship text-only first; add live previews behind a config flag.

### Interactions

- **Click thumbnail** → navigate to that slide
- **Right-click** → context menu (future: duplicate, reorder, insert-after)
- **Drag** (future) → reorder slides in source
- **Keyboard**: drawer is focusable; `↑/↓` moves selection, `Enter` jumps
- **Resize handle** on drawer's right edge; drag to resize, persisted

### Toggle

- **Global shortcut**: proposed `Shift+T` (T for "thumbnails"; not currently
  bound; confirm against `packages/client/logic/hotkeys.ts`).
- **UI**: icon button in `NavControls` or `Settings`.
- Off by default. Auto-on in editor mode? TBD — keep off to start.

### Presentation modes

The drawer should be available in:

- **Player/author** (default view while developing)
- **Print/export**: irrelevant (hidden)
- **Presenter mode** (`/presenter`): probably hidden by default — presenter
  already has a next-slide preview. Can be opt-in.
- **Fullscreen presentation** (`f` key): hidden.

## Architecture

### New files (proposed paths, final locations TBD)

```
packages/client/
  internals/
    SlidesDrawer.vue        # the panel itself
    SlideThumbnail.vue      # one thumbnail; takes slideIndex prop
  composables/
    useSlidesDrawer.ts      # drawer state (visible, width)
```

### State

```ts
// Persisted to localStorage per deck (keyed by deck id/path).
interface SlidesDrawerState {
  visible: boolean       // default: false
  width: number          // default: 200; clamp [120, 400]
  mode: 'text' | 'live'  // default: 'text'
}
```

Expose as a composable so `SlidesDrawer`, the toggle button, and the main
layout can all read/write.

### Layout integration

The tricky bit: the drawer needs to offset the slide canvas, but Slidev's
canvas uses an aspect-ratio-preserving transform. Proposed approach:

1. Wrap the existing canvas container with a new grid container:
   `[drawer?] [canvas]`.
2. When drawer is visible, the canvas cell shrinks; Slidev's existing
   auto-resize recomputes the scale. (Confirm that the canvas resize
   observer picks this up; if not, trigger manually on drawer toggle.)
3. Print export bypasses this layer entirely (use `v-if` on the grid
   wrapper, not just CSS).

### Thumbnail rendering

**Text-only (v1)**:

```vue
<template>
  <button class="thumb" :class="{ active }" @click="goto(index)">
    <span class="thumb-idx">{{ index + 1 }}</span>
    <span class="thumb-title">{{ title }}</span>
  </button>
</template>
```

Title comes from:
1. `frontmatter.title`, if set
2. First heading in slide source
3. Fallback: `"Slide N"`

(Existing parser output already has slide frontmatter + content; look for
`slide.meta.slide.title` or similar — check `packages/parser`.)

**Live preview (v2)**:

```vue
<template>
  <button class="thumb" :class="{ active }" @click="goto(index)">
    <div class="thumb-viewport">
      <SlideContainer :no="index" :scale="0.15" static />
    </div>
  </button>
</template>
```

- `SlideContainer` with `scale` prop renders at fractional size via a CSS
  `transform: scale()` on the existing slide DOM.
- `static` prop disables click handlers, hotkeys, and animations inside the
  preview.
- Use `IntersectionObserver` on the drawer's scroll area to mount thumbs lazily
  — crucial for decks with many slides.
- Pool offscreen thumbs to avoid thrashing on fast scroll.

Concerns to validate with a prototype:
- Plotly/Mermaid/Monaco components inside a 15% scale. Monaco in particular
  refuses to render in a 0-width container; needs a minimum layout size.
- Clicks inside a slide (onclick overlays) must not fire from the thumbnail
  (CSS `pointer-events: none` on `SlideContainer` contents, except the outer
  button).
- Scroll animations / timed transitions inside a thumb — skip or freeze.

### Active-slide detection

Slidev already has `currentSlideNo` as reactive global state (see
`packages/client/state/` or `composables/`). Subscribe to that; set the
matching thumb's `active` class; `scrollIntoView` on active change so the
current thumb stays visible in the drawer.

### Click → navigate

Use the existing `go` helper from `composables/useNav.ts` (or equivalent — the
same code path that `Goto.vue` uses). No new navigation logic required.

## Accessibility

- Drawer is a `<nav aria-label="Slide index">`.
- Thumbnails are `<button aria-current="true">` when active.
- Roving tabindex inside the thumb list.
- Keyboard shortcut to focus the drawer (`Shift+T` toggles visibility; once
  visible, focus moves to the active thumb).
- Screen reader text: `"Slide N: {title}, current slide"` for the active one.

## Open questions

1. **Does Slidev's slide parser already expose a canonical "slide title"?**
   If not, add it in `packages/parser`.
2. **Drawer in presenter mode: hidden or opt-in?** My vote: opt-in. Presenters
   may already have muscle memory for `o`.
3. **Live-preview cost on large decks**: benchmark with a 200-slide deck
   before committing to live previews as a shipped feature.
4. **Mobile**: drawer would eat a big chunk of a phone viewport. Auto-collapse
   below some breakpoint (e.g. `max-width: 720px`), toggle reveals as an
   overlay instead of a split.
5. **Theme compatibility**: OA's theme (and others) set specific backgrounds
   on slides — the thumb should inherit the theme so previews look right.
   Should be automatic if the thumb reuses `SlideContainer`.
6. **Does `@slidev/client` export enough for a theme to *override* the drawer
   (custom layout)?** Probably worth allowing, since the value prop is "I want
   this, but with *my* styling."

## Implementation phasing

1. **P1 — text-only drawer, off by default.** Toggle via icon + hotkey,
   persisted state, click-to-navigate, active-slide highlight. No live
   previews. Covers the primary authoring use case.
2. **P2 — live mini-previews behind config flag.** Lazy-mount, virtualized.
   Validate on a large deck before default-on.
3. **P3 — drag-to-reorder.** Writes back to the source markdown (reuses
   whatever mechanism moves `dragPos` edits — see `dragpos-persistence.md`).

P1 alone is shippable and valuable; P2/P3 are follow-ups.

## Relation to existing features

- **`QuickOverview`** (`o`): keep; the drawer supplements, doesn't replace.
  Same `goto` logic; no code duplication needed.
- **`NavControls`**: the drawer's toggle button lives here.
- **Speaker/presenter view**: unaffected by default.
- **Editor panel** (`packages/client/pages/edit.vue` or similar): the drawer
  makes editor-mode navigation much faster; likely the first place users will
  want it default-on.

## As built

P1–P3 shipped together.

### Files

- `packages/client/internals/SlidesDrawer.vue`: the panel (`<nav aria-label="Slide index">`): header with a titles / previews toggle and Close, the thumb list, an edit-mode "Drag to reorder" footer, and a resize handle on the right edge.
- `packages/client/internals/SlideThumbnail.vue`: one `<button>` per slide (`data-slide-no`, `aria-current`, `aria-label="Slide N: title[, current slide]"`).
- `packages/client/composables/useSlidesDrawer.ts`: reactive `slidesDrawer` state `{ visible, width, mode }` (defaults `false` / `200` / `'text'`), `clampDrawerWidth` ([120, 400]), `parseDrawerState`, `toggleSlidesDrawer(visible?, { focus })`.
- `packages/client/composables/slide-reorder.ts`: `dropPosition` + `reorderSlides`, extracted from `QuickOverview.vue`, which now uses them too.
- Wiring: `pages/play.vue` (layout), `internals/NavControls.vue` (toggle button), `setup/shortcuts.ts` (`toggle_slides_drawer`).

### Decisions / deviations

- **Hotkey `⇧T`** (`toggle_slides_drawer`, `display: ['⇧T']`), and a nav-bar `IconButton` (`side-panel-open` / `side-panel-close` icon) with `shortcut="toggle_slides_drawer"`, so the tooltip shows the key. The button is hidden in presenter mode and embeds.
- **Persistence**: one localStorage key, `slidev-slides-drawer`, holding JSON; it's per browser, not per deck (like the other `slidev-*` settings). Reads and writes are in try/catch, and malformed or missing fields fall back to the defaults one field at a time.
- **Layout**: the drawer is the first column of `#page-root`'s grid (`max-content 1fr max-content`, or `max-content 1fr` beside the vertical editor with the drawer spanning the rows). `SlideContainer`'s `useElementSize` rescales the slide by itself, so nothing needs a manual resize. Below Tailwind `md` (768px) the drawer floats over the slide (`overlay`) instead, and picking a slide closes it.
- **Hidden** in print mode, embeds, fullscreen and presenter mode (it isn't mounted in `presenter.vue`; opt-in there is left for later).
- **Titles**: `route.meta.slide.title` (the parser already derives it from frontmatter `title` or the first heading), rendered with `#slidev/title-renderer`. Untitled slides show "Slide N".
- **Live previews (P2)**: a per-browser drawer-header toggle stored as `mode`, rather than a deck config flag. Default stays `'text'`. Each preview is the overview's `SlideContainer` + `SlideWrapper render-context="overview"` + `DrawingPreview` at `width - 64` px, under `pointer-events-none`, and it uses snapshots when they exist. Lazy mounting: an `IntersectionObserver` rooted on the list, with `rootMargin: 100% 0px`, mounts a preview when it comes within one drawer height of the visible area and unmounts it once it leaves. A fixed-size placeholder keeps the scroll height steady. There's no pooling, and no benchmark on a 200-slide deck yet.
- **Keyboard / a11y**: roving tabindex (only the focused thumb has `tabindex=0`, and it follows the current slide). ↑ / ↓ / Home / End move focus without navigating; Enter (a native button click) jumps. ← / → still page the deck, Esc closes the drawer, and opening it with `⇧T` focuses the current thumb. A mouse click blurs the thumb, so the deck's shortcuts (which are off while a button has focus) keep working.
  - `⇧T` pressed inside the drawer only blurs the thumb, and the global shortcut then does the toggle. Closing the drawer directly would let the still-held keys reopen it: the magic-key shortcuts fire as soon as they're re-enabled. Without the blur, the thumb is removed while the keys are still down.
- **Active slide**: highlighted with the primary border and a tint. It's `scrollIntoView({ block: 'nearest' })`'d on mount and on every slide change.
- **Reorder (P3)**: in dev edit mode, drag a thumb onto another's upper or lower half to drop it before or after; a blue bar marks the target. This uses the overview's `POST /__slidev/slides/reorder {op: 'move'}`. Slide 1 (headmatter) can't be dragged or dropped in front of.
- **Side fix**: `play.vue`'s 15% click-to-page hot zones are now measured relative to the slide container, not the window, so they stay correct when the drawer or side editor narrows the slide.
- Not done: right-click context menu, ⌘X/⌘C/⌘V inside the drawer (the overview still has them), opt-in for presenter mode, theme override hooks.

### Tests

- `test/slides-drawer.test.ts` (vitest): `parseDrawerState` (defaults, per-field fallback, garbage input), `clampDrawerWidth`, `dropPosition`.
- `cypress/e2e/examples/slides-drawer.spec.ts` (5 tests):
  - Off by default. `⇧T` opens it with all 31 labels exact, current slide marked, focus on the active thumb, and the slide canvas starting at x = 200. ↑ / ↓ / Enter work, as do Esc and `⇧T` to close, and the stored state is checked.
  - Click navigates, then → still pages. The nav button toggles the drawer, and it survives a reload.
  - Resize handle: +80px gives 280, and the width is clamped at 120.
  - Live previews mount as a contiguous run at the top, rendering "Page 2"; at `/31` the run is at the bottom.
  - Drag-reorder moves 26 after 27 and back, leaving the fixture byte-identical.
  - Cypress quirk: after a thumb is removed, `type()` sends its keyup to the detached element, so the deck never sees the keys released. That's why the spec closes with `⇧T` last.
