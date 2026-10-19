<script setup lang="ts">
import type { SlideRoute } from '@slidev/types'
import type { ThumbnailMode } from '../composables/useSlidesDrawer'
import { useIntersectionObserver } from '@vueuse/core'
import { computed, ref } from 'vue'
import TitleRenderer from '#slidev/title-renderer'
import { createFixedClicks } from '../composables/useClicks'
import { CLICKS_MAX } from '../constants'
import { slideAspect } from '../env'
import { isSkippedRoute } from '../logic/skip'
import DrawingPreview from './DrawingPreview.vue'
import SlideContainer from './SlideContainer.vue'
import SlideWrapper from './SlideWrapper.vue'

const props = defineProps<{
  route: SlideRoute
  active: boolean
  mode: ThumbnailMode
  /** Width of a live preview, in px. */
  previewWidth: number
  /** The drawer's scroll area: live previews mount only while in (or near) it. */
  scrollRoot: HTMLElement | null
  focusable: boolean
}>()

const emit = defineEmits<{ select: [no: number, ev: MouseEvent] }>()

const title = computed(() => props.route.meta?.slide?.title?.trim() || '')
const skipped = computed(() => isSkippedRoute(props.route))
const label = computed(() => `Slide ${props.route.no}${title.value ? `: ${title.value}` : ''}${skipped.value ? ', skipped' : ''}${props.active ? ', current slide' : ''}`)

// Mounting every slide at once is expensive (iframes, Mermaid, Monaco…), so a live preview is
// only rendered while it's within a screenful of the drawer's visible area, and unmounted again
// once it scrolls far away. The placeholder keeps the same size, so the list doesn't jump.
const button = ref<HTMLButtonElement | null>(null)
const near = ref(false)
useIntersectionObserver(
  button,
  ([entry]) => near.value = entry?.isIntersecting ?? false,
  { root: computed(() => props.scrollRoot), rootMargin: '100% 0px' },
)
const showPreview = computed(() => props.mode === 'live' && near.value)
const previewHeight = computed(() => props.previewWidth / slideAspect.value)
</script>

<template>
  <button
    ref="button"
    type="button"
    class="slidev-thumb"
    :class="{ active, live: mode === 'live', skipped }"
    :data-slide-no="route.no"
    :aria-current="active ? 'true' : undefined"
    :aria-label="label"
    :tabindex="focusable ? 0 : -1"
    @click="emit('select', route.no, $event)"
  >
    <span class="slidev-thumb-no">{{ route.no }}<span v-if="skipped" class="slidev-thumb-skip i-carbon:skip-forward-outline" /></span>
    <span
      v-if="mode === 'live'"
      class="slidev-thumb-preview"
      :style="{ width: `${previewWidth}px`, height: `${previewHeight}px` }"
    >
      <SlideContainer
        v-if="showPreview"
        :no="route.no"
        :use-snapshot="true"
        :width="previewWidth"
        class="pointer-events-none"
      >
        <SlideWrapper
          :clicks-context="createFixedClicks(route, CLICKS_MAX)"
          :route="route"
          render-context="overview"
        />
        <DrawingPreview :page="route.no" />
      </SlideContainer>
    </span>
    <span v-else class="slidev-thumb-title">
      <TitleRenderer v-if="title" :no="route.no" />
      <template v-else>Slide {{ route.no }}</template>
    </span>
  </button>
</template>

<style scoped>
.slidev-thumb {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  width: 100%;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  text-align: left;
  font-size: 0.8125rem;
  line-height: 1.25rem;
}
.slidev-thumb:hover {
  background: rgba(125, 125, 125, 0.12);
}
.slidev-thumb:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.6);
  outline-offset: -2px;
}
.slidev-thumb.active {
  border-color: var(--slidev-theme-primary, rgb(59, 130, 246));
  background: rgba(59, 130, 246, 0.14);
}
.slidev-thumb-no {
  flex: none;
  min-width: 1.5rem;
  text-align: right;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}
.slidev-thumb.skipped > :not(.slidev-thumb-no) {
  opacity: 0.45;
}
.slidev-thumb-skip {
  display: block;
  margin: 0.125rem 0 0 auto;
  font-size: 0.75rem;
}
.slidev-thumb.active .slidev-thumb-no {
  opacity: 1;
  font-weight: 600;
}
.slidev-thumb-title {
  flex: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* `TitleRenderer` emits the title as markdown: drop its paragraph margins, keep it on one line. */
.slidev-thumb-title :deep(p) {
  display: inline;
  margin: 0;
}
.slidev-thumb-preview {
  flex: none;
  display: block;
  overflow: hidden;
  border-radius: 0.25rem;
  border: 1px solid rgba(125, 125, 125, 0.3);
  background: rgba(125, 125, 125, 0.08);
}
</style>
