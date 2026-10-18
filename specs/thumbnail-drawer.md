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
