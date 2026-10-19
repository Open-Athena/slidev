<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { dropPosition, reorderSlides } from '../composables/slide-reorder'
import { useNav } from '../composables/useNav'
import { clampDrawerWidth, drawerFocusRequested, slidesDrawer, toggleSlidesDrawer } from '../composables/useSlidesDrawer'
import { editMode } from '../state'
import IconButton from './IconButton.vue'
import SlideThumbnail from './SlideThumbnail.vue'

const props = defineProps<{
  /** Float over the slide instead of taking a column (narrow windows); a pick then closes it. */
  overlay?: boolean
}>()

const { currentSlideNo, go, next, prev, slides } = useNav()

const list = ref<HTMLElement | null>(null)

// Roving tabindex: one thumb is in the tab order; ↑ / ↓ / Home / End move it, Enter (the
// button's own click) jumps there. It follows the current slide.
const focusNo = ref(currentSlideNo.value)
watch(currentSlideNo, no => focusNo.value = no)

function thumbEl(no: number): HTMLElement | null {
  return list.value?.querySelector<HTMLElement>(`[data-slide-no="${no}"]`) ?? null
}

function scrollToActive() {
  thumbEl(currentSlideNo.value)?.scrollIntoView({ block: 'nearest' })
}
watch(currentSlideNo, () => nextTick(scrollToActive))

function focusThumb(no: number) {
  focusNo.value = no
  void nextTick(() => {
    const el = thumbEl(no)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest' })
  })
}

onMounted(scrollToActive)
watch(drawerFocusRequested, (requested) => {
  if (!requested)
    return
  drawerFocusRequested.value = false
  focusThumb(currentSlideNo.value)
}, { immediate: true })

function onSelect(no: number, ev: MouseEvent) {
  go(no)
  // A mouse click shouldn't leave focus on the button: the deck's shortcuts (←/→, space…) are
  // off while a button is focused. Keyboard activation (Enter / space, `detail === 0`) keeps it.
  if (ev.detail > 0)
    (ev.currentTarget as HTMLElement | null)?.blur()
  if (props.overlay)
    toggleSlidesDrawer(false)
}

function onKeydown(ev: KeyboardEvent) {
  const nos = slides.value.map(s => s.no)
  const i = nos.indexOf(focusNo.value)
  let target: number | undefined
  if (ev.key === 'ArrowDown') {
    target = nos[Math.min(nos.length - 1, i + 1)]
  }
  else if (ev.key === 'ArrowUp') {
    target = nos[Math.max(0, i - 1)]
  }
  else if (ev.key === 'Home') {
    target = nos[0]
  }
  else if (ev.key === 'End') {
    target = nos.at(-1)
  }
  else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
    // The deck's own ←/→ are off while a thumb has focus; keep them paging the deck.
    ev.preventDefault()
    void (ev.key === 'ArrowRight' ? next() : prev())
    return
  }
  else if (ev.key === 'Escape') {
    ev.preventDefault()
    toggleSlidesDrawer(false)
    return
  }
  else if (ev.key.toLowerCase() === 't' && ev.shiftKey) {
    // The deck's shortcuts are off while a button has focus, and they're key-*state* based: they
    // fire as soon as they're re-enabled with the keys still down. So closing here would let the
    // still-held ⇧T reopen the drawer once its focused thumb is gone. Dropping focus instead lets
    // the global `⇧T` do the toggling, exactly once.
    ev.preventDefault()
    ;(document.activeElement as HTMLElement | null)?.blur()
    return
  }
  if (target == null)
    return
  ev.preventDefault()
  ev.stopPropagation()
  focusThumb(target)
}

// Resize from the right edge; the width is persisted with the rest of the drawer state.
const resizing = ref(false)
function onResizeStart(ev: PointerEvent) {
  if (ev.button !== 0)
    return
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  const startX = ev.clientX
  const startWidth = slidesDrawer.width
  resizing.value = true
  const move = (e: PointerEvent) => {
    slidesDrawer.width = clampDrawerWidth(startWidth + e.clientX - startX)
  }
  const up = () => {
    resizing.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
}

// Number column + gaps + padding + scrollbar, taken off the drawer width.
const previewWidth = computed(() => Math.max(60, slidesDrawer.width - 64))

// Reordering (dev + edit mode): drag a thumb onto another's upper / lower half. Same dev-server
// endpoint as the overview's; slide 1 holds the deck's headmatter, so it stays first.
const canReorder = computed(() => __DEV__ && editMode.value)
const dragFrom = ref<number | null>(null)
const dropAt = ref<{ no: number, after: boolean } | null>(null)

function onDragstart(ev: DragEvent, no: number) {
  if (!canReorder.value || no === 1)
    return ev.preventDefault()
  dragFrom.value = no
  ev.dataTransfer?.setData('text/plain', String(no))
  if (ev.dataTransfer)
    ev.dataTransfer.effectAllowed = 'move'
}

function onDragover(ev: DragEvent, no: number) {
  if (dragFrom.value == null)
    return
  ev.preventDefault()
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  dropAt.value = { no, after: no === 1 || ev.clientY > rect.top + rect.height / 2 }
}

function onDrop(ev: DragEvent) {
  ev.preventDefault()
  const from = dragFrom.value
  const target = dropAt.value
  dragFrom.value = dropAt.value = null
  if (from == null || !target)
    return
  const to = dropPosition(from, target.no, target.after)
  if (to !== from)
    void reorderSlides('move', from, to)
}

function onDragend() {
  dragFrom.value = dropAt.value = null
}
</script>

<template>
  <nav
    aria-label="Slide index"
    class="slidev-slides-drawer relative h-full max-h-screen bg-main border-r border-main flex flex-col overflow-hidden select-none"
    :class="[overlay ? 'fixed left-0 top-0 bottom-0 z-modal shadow-2xl' : '', resizing ? 'cursor-col-resize' : '']"
    :style="{ width: `${slidesDrawer.width}px` }"
  >
    <header class="flex items-center gap-1 pl-3 pr-1 py-1 border-b border-main">
      <h2 class="text-sm font-semibold flex-auto">
        Slides
      </h2>
      <IconButton
        :title="slidesDrawer.mode === 'live' ? 'Show titles' : 'Show previews'"
        class="text-base"
        data-testid="drawer-mode"
        @click="slidesDrawer.mode = slidesDrawer.mode === 'live' ? 'text' : 'live'"
      >
        <div :class="slidesDrawer.mode === 'live' ? 'i-carbon:list' : 'i-carbon:thumbnail-2'" />
      </IconButton>
      <IconButton title="Close" shortcut="toggle_slides_drawer" class="text-base" @click="toggleSlidesDrawer(false)">
        <div class="i-carbon:close" />
      </IconButton>
    </header>
    <ol
      ref="list"
      class="flex-auto overflow-y-auto overscroll-contain p-1.5 flex flex-col gap-0.5"
      @keydown="onKeydown"
    >
      <li
        v-for="route of slides"
        :key="route.no"
        class="relative"
        :draggable="canReorder && route.no !== 1"
        :class="{
          'opacity-40': dragFrom === route.no,
          'slidev-drop-before': dropAt?.no === route.no && !dropAt.after,
          'slidev-drop-after': dropAt?.no === route.no && dropAt.after,
        }"
        @dragstart="onDragstart($event, route.no)"
        @dragover="onDragover($event, route.no)"
        @drop="onDrop"
        @dragend="onDragend"
      >
        <SlideThumbnail
          :route="route"
          :active="route.no === currentSlideNo"
          :mode="slidesDrawer.mode"
          :preview-width="previewWidth"
          :scroll-root="list"
          :focusable="route.no === focusNo"
          @select="onSelect"
        />
      </li>
    </ol>
    <div
      v-if="canReorder"
      class="px-2 py-1 border-t border-main text-xs opacity-60"
    >
      Drag to reorder
    </div>
    <div
      class="slidev-drawer-resizer absolute top-0 bottom-0 -right-1 w-2 cursor-col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize slide index"
      :aria-valuenow="slidesDrawer.width"
      @pointerdown="onResizeStart"
    />
  </nav>
</template>

<style scoped>
.slidev-slides-drawer {
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    'Helvetica Neue',
    Arial,
    sans-serif;
}
.slidev-drawer-resizer:hover {
  background: rgba(59, 130, 246, 0.35);
}
.slidev-drop-before::before,
.slidev-drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 2px;
  background: rgb(59 130 246);
  z-index: 1;
}
.slidev-drop-before::before {
  top: -2px;
}
.slidev-drop-after::after {
  bottom: -2px;
}
</style>
