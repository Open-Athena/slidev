<script setup lang="ts">
import { useStyleTag } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'
import { useColumnResize } from '../composables/useColumnResize'
import { useCopyPaste } from '../composables/useCopyPaste'
import { useDrawings } from '../composables/useDrawings'
import { useFileDrop } from '../composables/useFileDrop'
import { useHideCursorIdle } from '../composables/useHideCursorIdle'
import { useNav } from '../composables/useNav'
import { usePasteImage } from '../composables/usePasteImage'
import { usePinchZoomPan } from '../composables/usePinchZoomPan'
import { slidesDrawer } from '../composables/useSlidesDrawer'
import { useSwipeControls } from '../composables/useSwipeControls'
import { useTextEditing } from '../composables/useTextEditing'
import { useWakeLock } from '../composables/useWakeLock'
import Controls from '../internals/Controls.vue'
import LaserPointer from '../internals/LaserPointer.vue'
import NavControls from '../internals/NavControls.vue'
import PresenterMouse from '../internals/PresenterMouse.vue'
import SlideContainer from '../internals/SlideContainer.vue'
import SlidesDrawer from '../internals/SlidesDrawer.vue'
import SlidesShow from '../internals/SlidesShow.vue'
import SlugChip from '../internals/SlugChip.vue'
import { onContextMenu } from '../logic/contextMenu'
import { registerShortcuts } from '../logic/shortcuts'
import { breakpoints, editorHeight, editorWidth, fullscreen, isEditorVertical, isScreenVertical, showEditor, viewerCssFilter, viewerCssFilterDefaults } from '../state'

const { next, prev, isPrintMode, isPlaying, isEmbedded } = useNav()
const { isDrawing } = useDrawings()
// Whether the auto-hiding nav bar (non-persist mode) is currently summoned.
const navHover = ref(false)

const root = ref<HTMLDivElement>()
function onClick(e: MouseEvent) {
  if (showEditor.value)
    return

  const target = e.target as HTMLElement | null
  if (e.button === 0 && target?.id === 'slide-container') {
    // Only the outer 15% on each side advances/rewinds slides. The middle 70%
    // (and the letterbox/pillarbox bars near vertical center) is a no-op, so
    // clicking off-element to defocus doesn't accidentally page the deck.
    // Relative to the slide's own column: the slide index or side editor can take part of the window.
    const rect = target.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const HOT = 0.15
    if (x < HOT)
      prev()
    else if (x > 1 - HOT)
      next()
  }
}

usePinchZoomPan(root)
useSwipeControls(root)
registerShortcuts()
const { dropActive: fileDropActive, inFlight: fileDropInFlight } = useFileDrop()
if (__DEV__ && __SLIDEV_FEATURE_EDITOR__) {
  useTextEditing()
  useColumnResize()
  useCopyPaste()
}
usePasteImage()
if (__SLIDEV_FEATURE_WAKE_LOCK__)
  useWakeLock()
useHideCursorIdle(computed(() => isPlaying.value && !isEmbedded.value && !showEditor.value))

if (import.meta.hot) {
  useStyleTag(computed(() => showEditor.value
    ? `
    vite-error-overlay {
      --width: calc(100vw - ${isEditorVertical.value ? 0 : editorWidth.value}px);
      --height: calc(100vh - ${isEditorVertical.value ? editorHeight.value : 0}px);
      position: fixed;
      left: 0;
      top: 0;
      width: calc(var(--width) / var(--slidev-slide-scale));
      height: calc(var(--height) / var(--slidev-slide-scale));
      transform-origin: top left;
      transform: scale(var(--slidev-slide-scale));
    }`
    : '',
  ))
}

// The slide index (`⇧T`): a column left of the slide, which then rescales to the rest of the
// width; on narrow windows it floats over the slide instead. Not in fullscreen, print or embeds.
const narrow = breakpoints.smaller('md')
const showSlidesDrawer = computed(() => slidesDrawer.visible && !isPrintMode.value && !isEmbedded.value && !fullscreen.isFullscreen.value)
const drawerColumn = computed(() => showSlidesDrawer.value && !narrow.value)
const gridClass = computed(() => isEditorVertical.value
  ? (drawerColumn.value ? 'grid-rows-[1fr_max-content] grid-cols-[max-content_1fr]' : 'grid-rows-[1fr_max-content]')
  : (drawerColumn.value ? 'grid-cols-[max-content_1fr_max-content]' : 'grid-cols-[1fr_max-content]'))

const persistNav = computed(() => isScreenVertical.value || showEditor.value)

const SideEditor = shallowRef<any>()
const HistoryDrawer = shallowRef<any>()
// SideEditor writes back to slides.md source — only useful in dev mode.
if (__DEV__ && __SLIDEV_FEATURE_EDITOR__)
  import('../internals/SideEditor.vue').then(v => SideEditor.value = v.default)
// HistoryDrawer reads/writes through the IStateClient abstraction (RemoteStateClient in
// dev, LocalStateClient in static deploys), so it's useful in either mode — load it
// always.
import('../internals/HistoryDrawer.vue').then(v => HistoryDrawer.value = v.default)

const contentStyle = computed(() => {
  let filter = ''

  if (viewerCssFilter.value.brightness !== viewerCssFilterDefaults.brightness)
    filter += `brightness(${viewerCssFilter.value.brightness}) `
  if (viewerCssFilter.value.contrast !== viewerCssFilterDefaults.contrast)
    filter += `contrast(${viewerCssFilter.value.contrast}) `
  if (viewerCssFilter.value.sepia !== viewerCssFilterDefaults.sepia)
    filter += `sepia(${viewerCssFilter.value.sepia}) `
  if (viewerCssFilter.value.hueRotate !== viewerCssFilterDefaults.hueRotate)
    filter += `hue-rotate(${viewerCssFilter.value.hueRotate}deg) `
  if (viewerCssFilter.value.invert)
    filter += 'invert(1) '

  return {
    filter,
  }
})
</script>

<template>
  <div
    id="page-root" ref="root" class="grid"
    :class="gridClass"
  >
    <SlidesDrawer v-if="showSlidesDrawer" :overlay="narrow" class="row-span-full" />
    <SlideContainer
      :style="{ background: 'var(--slidev-slide-container-background, black)' }"
      is-main
      :content-style="contentStyle"
      @pointerdown="onClick"
      @contextmenu="onContextMenu"
    >
      <template #default>
        <SlidesShow render-context="slide" />
        <PresenterMouse />
        <div
          v-if="fileDropActive || fileDropInFlight"
          class="absolute inset-0 pointer-events-none flex items-center justify-center"
          :class="fileDropActive ? 'bg-blue-500/10 border-4 border-dashed border-blue-400' : 'bg-blue-500/5'"
        >
          <div class="bg-main px-4 py-2 rounded shadow text-sm op-90">
            {{ fileDropInFlight ? 'Inserting…' : 'Drop image / video to insert into this slide' }}
          </div>
        </div>
        <LaserPointer />
      </template>
      <template #controls>
        <SlugChip />
        <template v-if="!isPrintMode">
          <!-- Narrow "summon" strip. Hovering the bar's full footprint used to pop
               it open — and, being only opacity-0 (not removed), it also swallowed
               clicks over any slide content in the lower-left. Restrict the hover
               target to a thin bottom strip, and make the hidden bar
               pointer-events-none so clicks pass through to the slide. -->
          <div
            v-if="!persistNav"
            class="absolute bottom-0 left-0 h-3.5 w-80"
            @mouseenter="navHover = true"
          />
          <div
            class="absolute bottom-0 left-0 transition duration-300 focus-within:opacity-100 focus-within:pointer-events-auto"
            :class="[
              persistNav ? '!opacity-100 right-0' : (navHover ? 'opacity-100 p-2' : 'opacity-0 pointer-events-none p-2'),
              isDrawing ? 'pointer-events-none' : '',
            ]"
            @mouseenter="navHover = true"
            @mouseleave="navHover = false"
          >
            <NavControls :persist="persistNav" />
          </div>
        </template>
      </template>
    </SlideContainer>
    <SideEditor v-if="SideEditor && showEditor" :resize="true" />
    <component :is="HistoryDrawer" v-if="HistoryDrawer" />
  </div>
  <Controls v-if="!isPrintMode" />
  <div id="twoslash-container" />
</template>
