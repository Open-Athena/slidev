<!--
A simple wrapper for embeded YouTube videos

Usage:

<Youtube id="luoMHjh-XcQ" />
-->

<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import VDrag from './VDrag.vue'

const props = withDefaults(defineProps<{
  id: string
  width?: number
  height?: number
  draggable?: boolean
}>(), {
  draggable: true,
})

// YouTube's embed renders its UI (play button, title, controls) at fixed pixel
// sizes that don't shrink with the iframe. To get a usable thumbnail at small
// drag sizes, render the iframe at natural dims and visually scale via CSS
// transform to fit the v-drag wrapper width.
const NATURAL_W = 560
const NATURAL_H = 315

const naturalW = computed(() => props.width ?? NATURAL_W)
const naturalH = computed(() => props.height ?? NATURAL_H)

const wrapper = ref<HTMLElement | null>(null)
const { width: wrapperWidth } = useElementSize(wrapper)
const fitScale = computed(() => wrapperWidth.value > 0 ? wrapperWidth.value / naturalW.value : 1)
const iframeStyle = computed(() => ({
  transform: `scale(${fitScale.value})`,
  transformOrigin: 'top left',
}))

// Geometry-correct wrap AR (see BlueSky.vue for derivation). YouTube's content
// AR is fixed at NATURAL_W/NATURAL_H, but the v-drag's `p-1` padding (8 px in
// each axis) makes a constant `naturalW / naturalH` slightly off — the wrap
// ends up taller than the content, leaving a visible gap below the iframe at
// typical widths. Recompute per-width so the fit stays tight.
const ytAR = computed(() => {
  const fitW = wrapperWidth.value
  if (fitW <= 0)
    return naturalW.value / naturalH.value
  return (fitW + 8) / (8 + naturalH.value * fitW / naturalW.value)
})
</script>

<template>
  <VDrag v-if="props.draggable !== false" :pos="`yt-${id}`" :lock-aspect-ratio="ytAR">
    <div ref="wrapper" class="youtube-fit">
      <!-- DragControl.associatedLink picks this up via `querySelector('a')`,
           surfacing a clickable URL in the control bar when the embed is selected. -->
      <a :href="`https://www.youtube.com/watch?v=${id}`" target="_blank" rel="noopener noreferrer" aria-hidden="true" class="youtube-link" />
      <iframe
        class="youtube"
        :width="naturalW"
        :height="naturalH"
        :src="`https://www.youtube.com/embed/${id}`"
        :style="iframeStyle"
        title="YouTube"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      />
    </div>
  </VDrag>
  <iframe
    v-else
    class="youtube"
    :width="width"
    :height="height"
    :src="`https://www.youtube.com/embed/${id}`"
    title="YouTube"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen
  />
</template>

<style scoped>
.youtube-fit {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.youtube-link {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
</style>
