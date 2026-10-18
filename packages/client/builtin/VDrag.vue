<script setup lang="ts">
import type { DragElementMarkdownSource } from '../composables/useDragElements'
import { onMounted, onUnmounted, watchEffect } from 'vue'
import { handleBodyDragPointerdown } from '../composables/useBodyDragHandler'
import { useDragElement } from '../composables/useDragElements'
import { editMode } from '../state'

const props = withDefaults(defineProps<{
  pos?: string
  markdownSource?: DragElementMarkdownSource
  // Lock the wrapper's aspect ratio (width / height) to this value. Used by Youtube /
  // Tweet wrappers around fixed-AR content. Falsy = free resize.
  lockAspectRatio?: number
  // Keep the element's slot in the layout (see `dragLayout: flow`). Unset = the slide's `dragLayout`.
  flow?: boolean
}>(), { flow: undefined })

const state = useDragElement(null, props.pos, props.markdownSource, false, props.flow)
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

function handleClick(ev: MouseEvent) {
  if (!editMode.value)
    return
  ev.preventDefault()
  ev.stopPropagation()
}

function handleDblclick(ev: MouseEvent) {
  if (!editMode.value)
    return
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
    :data-drag-editing="enabled && editMode ? '' : undefined"
    :data-drag-interact="isInteracting ? '' : undefined"
    :style="containerStyle"
    class="p-1"
    @pointerdown="handlePointerdown"
    @click="handleClick"
    @dblclick="handleDblclick"
  >
    <slot />
  </div>
</template>
