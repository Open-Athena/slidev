<script setup lang="ts">
import type { DragElementMarkdownSource } from '../composables/useDragElements'
import { onMounted, onUnmounted, watchEffect } from 'vue'
import { handleBodyDragPointerdown } from '../composables/useBodyDragHandler'
import { useDragElement } from '../composables/useDragElements'

const props = defineProps<{
  pos?: string
  markdownSource?: DragElementMarkdownSource
  // Lock the wrapper's aspect ratio (width / height) to this value. Used by Youtube /
  // Tweet wrappers around fixed-AR content. Falsy = free resize.
  lockAspectRatio?: number
}>()

const state = useDragElement(null, props.pos, props.markdownSource)
const { dragId, container, containerStyle, mounted, unmounted, enabled, isInteracting } = state

watchEffect(() => {
  state.lockAspectRatio.value = props.lockAspectRatio || null
})

function handlePointerdown(ev: PointerEvent) {
  // In iframe-interact mode (double-click to enter), let iframe clicks through —
  // skip the body-drag handler entirely so the user can interact with the embed.
  handleBodyDragPointerdown(ev, {
    state,
    shouldSkip: () => isInteracting.value,
  })
}

function handleDblclick(ev: MouseEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  const el = container.value
  if (!el)
    return
  if (el.querySelector('iframe'))
    state.enterInteractMode()
  else if (el.querySelector('img'))
    state.enterCropMode()
}

onMounted(mounted)
onUnmounted(unmounted)
</script>

<template>
  <div
    ref="container"
    :data-drag-id="dragId"
    :data-drag-editing="enabled ? '' : undefined"
    :data-drag-interact="isInteracting ? '' : undefined"
    :style="containerStyle"
    class="p-1"
    @pointerdown="handlePointerdown"
    @click.prevent.stop
    @dblclick.prevent.stop="handleDblclick"
  >
    <slot />
  </div>
</template>
