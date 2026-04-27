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
</script>

<template>
  <VDrag v-if="props.draggable !== false" :pos="`yt-${id}`" :lock-aspect-ratio="naturalW / naturalH">
    <div ref="wrapper" class="youtube-fit">
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
</style>
