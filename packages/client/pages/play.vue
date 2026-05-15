<script setup lang="ts">
import { useStyleTag } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'
import { useDrawings } from '../composables/useDrawings'
import { useFileDrop } from '../composables/useFileDrop'
import { useHideCursorIdle } from '../composables/useHideCursorIdle'
import { useNav } from '../composables/useNav'
import { usePasteImage } from '../composables/usePasteImage'
import { usePinchZoomPan } from '../composables/usePinchZoomPan'
import { useSwipeControls } from '../composables/useSwipeControls'
import { useWakeLock } from '../composables/useWakeLock'
import Controls from '../internals/Controls.vue'
import LaserPointer from '../internals/LaserPointer.vue'
import NavControls from '../internals/NavControls.vue'
import PresenterMouse from '../internals/PresenterMouse.vue'
import SlideContainer from '../internals/SlideContainer.vue'
import SlidesShow from '../internals/SlidesShow.vue'
import SlugChip from '../internals/SlugChip.vue'
import { onContextMenu } from '../logic/contextMenu'
import { registerShortcuts } from '../logic/shortcuts'
import { editorHeight, editorWidth, isEditorVertical, isScreenVertical, showEditor, viewerCssFilter, viewerCssFilterDefaults } from '../state'

const { next, prev, isPrintMode, isPlaying, isEmbedded } = useNav()
const { isDrawing } = useDrawings()

const root = ref<HTMLDivElement>()
function onClick(e: MouseEvent) {
  if (showEditor.value)
    return

  if (e.button === 0 && (e.target as HTMLElement)?.id === 'slide-container') {
    // Only the outer 15% on each side advances/rewinds slides. The middle 70%
    // (and the letterbox/pillarbox bars near vertical center) is a no-op, so
    // clicking off-element to defocus doesn't accidentally page the deck.
    const x = e.pageX / window.innerWidth
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
    :class="isEditorVertical ? 'grid-rows-[1fr_max-content]' : 'grid-cols-[1fr_max-content]'"
  >
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
        <div
          v-if="!isPrintMode"
          class="absolute bottom-0 left-0 transition duration-300 opacity-0 hover:opacity-100 focus-within:opacity-100 focus-visible:opacity-100"
          :class="[
            persistNav ? '!opacity-100 right-0' : 'opacity-0 p-2',
            isDrawing ? 'pointer-events-none' : '',
          ]"
        >
          <NavControls :persist="persistNav" />
        </div>
      </template>
    </SlideContainer>
    <SideEditor v-if="SideEditor && showEditor" :resize="true" />
    <component :is="HistoryDrawer" v-if="HistoryDrawer" />
  </div>
  <Controls v-if="!isPrintMode" />
  <div id="twoslash-container" />
</template>
