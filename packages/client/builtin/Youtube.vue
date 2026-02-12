<!--
A simple wrapper for embeded YouTube videos

Usage:

<Youtube id="luoMHjh-XcQ" />
-->

<script setup lang="ts">
import VDrag from './VDrag.vue'

const props = withDefaults(defineProps<{
  id: string
  width?: number
  height?: number
  draggable?: boolean
}>(), {
  draggable: true,
})
</script>

<template>
  <VDrag v-if="props.draggable !== false" :pos="`yt-${id}`">
    <iframe
      class="youtube"
      :width="width"
      :height="height"
      :src="`https://www.youtube.com/embed/${id}`"
      title="YouTube"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    />
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
