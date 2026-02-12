<script setup lang="ts">
import type { DragElementMarkdownSource } from '../composables/useDragElements'
import { onMounted, onUnmounted } from 'vue'
import { useDragElement } from '../composables/useDragElements'
import { addToSelection, isSelected, removeFromSelection } from '../composables/useMultiSelect'

const props = defineProps<{
  pos?: string
  markdownSource?: DragElementMarkdownSource
}>()

const state = useDragElement(null, props.pos, props.markdownSource)
const { dragId, container, containerStyle, mounted, unmounted, startDragging, enabled, isInteracting } = state

function handlePointerdown(ev: PointerEvent) {
  if (ev.button !== 0)
    return
  ev.preventDefault()
  ev.stopPropagation()

  // Handle multi-select with shift key
  if (ev.shiftKey) {
    if (isSelected(state)) {
      removeFromSelection(state)
    }
    else {
      addToSelection(state)
    }
    return
  }

  startDragging()
}

function handleDblclick(ev: MouseEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  if (container.value?.querySelector('iframe'))
    state.enterInteractMode()
  else
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
