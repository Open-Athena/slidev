<script setup lang="ts">
import type { ReorderOp } from '../composables/slide-reorder'
import { useEventListener } from '@vueuse/core'
import { computed, ref, watchEffect } from 'vue'
import { showNotice } from '../composables/notice'
import { dropPosition, reorderSlides } from '../composables/slide-reorder'
import { createFixedClicks } from '../composables/useClicks'
import { useNav } from '../composables/useNav'
import { isSlideSkipped, toggleSlideSkip } from '../composables/useSlideSkip'
import { CLICKS_MAX } from '../constants'
import { pathPrefix } from '../env'
import { currentOverviewPage, overviewRowCount } from '../logic/overview'
import { isScreenshotSupported } from '../logic/screenshot'
import { snapshotManager } from '../logic/snapshot'
import { breakpoints, editMode, showOverview, windowSize } from '../state'
import DrawingPreview from './DrawingPreview.vue'
import IconButton from './IconButton.vue'
import SlideContainer from './SlideContainer.vue'
import SlideWrapper from './SlideWrapper.vue'

const nav = useNav()
const { currentSlideNo, go: goSlide, slides } = nav

function close() {
  showOverview.value = false
}

function go(page: number) {
  goSlide(page)
  close()
}

function focus(page: number) {
  if (page === currentOverviewPage.value)
    return true
  return false
}

const xs = breakpoints.smaller('xs')
const sm = breakpoints.smaller('sm')

const padding = 4 * 16 * 2
const gap = 2 * 16
const cardWidth = computed(() => {
  if (xs.value)
    return windowSize.width.value - padding
  else if (sm.value)
    return (windowSize.width.value - padding - gap) / 2
  return 300
})

const rowCount = computed(() => {
  return Math.floor((windowSize.width.value - padding) / (cardWidth.value + gap))
})

const keyboardBuffer = ref<string>('')

async function captureSlidesOverview() {
  showOverview.value = false
  await snapshotManager.startCapturing(nav)
  showOverview.value = true
}

useEventListener('keypress', (e) => {
  if (!showOverview.value) {
    keyboardBuffer.value = ''
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (keyboardBuffer.value) {
      go(+keyboardBuffer.value)
      keyboardBuffer.value = ''
    }
    else {
      go(currentOverviewPage.value)
    }
    return
  }
  const num = Number.parseInt(e.key.replace(/\D/g, ''))
  if (Number.isNaN(num)) {
    keyboardBuffer.value = ''
    return
  }
  if (!keyboardBuffer.value && num === 0)
    return

  keyboardBuffer.value += String(num)

  // beyond the number of slides, reset
  if (+keyboardBuffer.value > slides.value.length) {
    keyboardBuffer.value = ''
    return
  }

  const extactMatch = slides.value.findIndex(i => `/${i.no}` === keyboardBuffer.value)
  if (extactMatch !== -1)
    currentOverviewPage.value = extactMatch + 1

  // When the input number is the largest at the number of digits, we go to that page directly.
  if (+keyboardBuffer.value * 10 > slides.value.length) {
    go(+keyboardBuffer.value)
    keyboardBuffer.value = ''
  }
})

// Reordering (dev + edit mode): drag a slide onto another's left / right half, or ⌘X / ⌘C a slide
// and ⌘V to move / copy it after the selected one. The dev server rewrites the markdown and
// renumbers positions and history. Slide 1 holds the deck's headmatter, so it stays first.
const canReorder = computed(() => __DEV__ && editMode.value)
const dragFrom = ref<number | null>(null)
const dropAt = ref<{ no: number, after: boolean } | null>(null)
const clipboard = ref<{ no: number, cut: boolean } | null>(null)

async function reorder(op: ReorderOp, from: number, to: number) {
  if (await reorderSlides(op, from, to))
    currentOverviewPage.value = to
}

function onDragstart(ev: DragEvent, no: number) {
  if (!canReorder.value || no === 1)
    return ev.preventDefault()
  dragFrom.value = no
  ev.dataTransfer?.setData('text/plain', String(no))
}

function onDragover(ev: DragEvent, no: number) {
  if (dragFrom.value == null)
    return
  ev.preventDefault()
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  dropAt.value = { no, after: no === 1 || ev.clientX > rect.left + rect.width / 2 }
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
    void reorder('move', from, to)
}

function onDragend() {
  dragFrom.value = dropAt.value = null
}

useEventListener('keydown', (e) => {
  if (!showOverview.value || !canReorder.value || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey)
    return
  const no = currentOverviewPage.value
  if (e.key === 'c' || e.key === 'x') {
    if (no === 1)
      return showNotice('Slide 1 holds the deck headmatter; it can\'t be moved or copied')
    e.preventDefault()
    clipboard.value = { no, cut: e.key === 'x' }
    showNotice(`${e.key === 'x' ? 'Cut' : 'Copied'} slide ${no}: select a slide and press ⌘V to put it after`)
  }
  else if (e.key === 'v' && clipboard.value) {
    e.preventDefault()
    const { no: from, cut } = clipboard.value
    if (cut) {
      clipboard.value = null
      const to = dropPosition(from, no, true)
      if (to !== from)
        void reorder('move', from, to)
    }
    else {
      void reorder('duplicate', from, no + 1)
    }
  }
})

watchEffect(() => {
  // Watch currentPage, make sure every time we open overview,
  // we focus on the right page.
  currentOverviewPage.value = currentSlideNo.value
  // Watch rowCount, make sure up and down shortcut work correctly.
  overviewRowCount.value = rowCount.value
})
</script>

<template>
  <Transition
    enter-active-class="duration-150 ease-out"
    enter-from-class="opacity-0 scale-102 !backdrop-blur-0px"
    leave-active-class="duration-200 ease-in"
    leave-to-class="opacity-0 scale-102 !backdrop-blur-0px"
  >
    <div
      v-if="showOverview"
      class="fixed left-0 right-0 top-0 h-[calc(var(--vh,1vh)*100)] z-modal bg-main !bg-opacity-75 p-16 py-20 overflow-y-auto backdrop-blur-5px select-none"
      @click="close"
    >
      <div
        class="grid gap-y-4 gap-x-8 w-full"
        :style="`grid-template-columns: repeat(auto-fit,minmax(${cardWidth}px,1fr))`"
      >
        <div
          v-for="(route, idx) of slides"
          :key="route.no"
          class="relative"
          :draggable="canReorder && route.no !== 1"
          :class="{
            'opacity-40': dragFrom === route.no || (clipboard?.cut && clipboard.no === route.no),
            'slidev-drop-before': dropAt?.no === route.no && !dropAt.after,
            'slidev-drop-after': dropAt?.no === route.no && dropAt.after,
          }"
          @dragstart="onDragstart($event, route.no)"
          @dragover="onDragover($event, route.no)"
          @drop="onDrop"
          @dragend="onDragend"
        >
          <div
            class="inline-block border rounded overflow-hidden bg-main hover:border-primary transition"
            :class="[
              (focus(idx + 1) || currentOverviewPage === idx + 1) ? 'border-primary' : 'border-main',
              isSlideSkipped(route.no) ? 'opacity-45' : '',
            ]"
            @click="go(route.no)"
          >
            <SlideContainer
              :key="route.no"
              :no="route.no"
              :use-snapshot="true"
              :width="cardWidth"
              class="pointer-events-none"
            >
              <SlideWrapper
                :clicks-context="createFixedClicks(route, CLICKS_MAX)"
                :route="route"
                render-context="overview"
              />
              <DrawingPreview :page="route.no" />
            </SlideContainer>
          </div>
          <div
            class="absolute top-0"
            :style="`left: ${cardWidth + 5}px`"
          >
            <template v-if="keyboardBuffer && String(idx + 1).startsWith(keyboardBuffer)">
              <span class="text-green font-bold">{{ keyboardBuffer }}</span>
              <span class="opacity-50">{{ String(idx + 1).slice(keyboardBuffer.length) }}</span>
            </template>
            <span v-else class="opacity-50">
              {{ idx + 1 }}
            </span>
            <button
              v-if="canReorder"
              type="button"
              class="block mt-1 p-0.5 rounded hover:bg-gray-400/20"
              :class="isSlideSkipped(route.no) ? 'i-carbon:skip-forward-filled opacity-90' : 'i-carbon:skip-forward-outline opacity-40'"
              :aria-label="isSlideSkipped(route.no) ? `Don't skip slide ${route.no}` : `Skip slide ${route.no} when presenting`"
              @click.stop="toggleSlideSkip(route.no)"
            />
            <div
              v-else-if="isSlideSkipped(route.no)"
              class="mt-1 i-carbon:skip-forward-outline opacity-60"
              :aria-label="`Slide ${route.no} is skipped`"
            />
          </div>
        </div>
      </div>
    </div>
  </Transition>
  <div
    v-if="showOverview && canReorder"
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-modal text-xs opacity-60 pointer-events-none"
  >
    Drag to reorder · ⌘X / ⌘C a slide, then ⌘V to put it after the selected one
  </div>
  <div
    v-show="showOverview"
    class="fixed top-4 right-4 z-modal text-gray-400 flex flex-col items-center gap-2"
  >
    <IconButton title="Close" class="text-2xl" @click="close">
      <div class="i-carbon:close" />
    </IconButton>
    <IconButton
      v-if="__SLIDEV_FEATURE_PRESENTER__"
      as="a"
      title="Slides Overview"
      target="_blank"
      :href="`${pathPrefix}overview`"
      tab-index="-1"
      class="text-2xl"
    >
      <div class="i-carbon:list-boxes" />
    </IconButton>
    <IconButton
      v-if="__DEV__ && isScreenshotSupported"
      title="Capture slides as images"
      class="text-2xl"
      @click="captureSlidesOverview"
    >
      <div class="i-carbon:drop-photo" />
    </IconButton>
  </div>
</template>

<style scoped>
.slidev-drop-before::before,
.slidev-drop-after::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 2px;
  background: rgb(59 130 246);
}
.slidev-drop-before::before {
  left: -18px;
}
.slidev-drop-after::after {
  right: -18px;
}
</style>
