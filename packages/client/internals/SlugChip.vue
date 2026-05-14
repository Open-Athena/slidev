<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNav } from '../composables/useNav'
import { configs } from '../env'
import { getSlidePath } from '../logic/slides'

// Dev-mode-only chip showing the current slide's canonical URL. Click copies
// the absolute share URL (deck `publish.baseUrl` + path) to clipboard. Same
// effect as the `y` hotkey, surfaced visibly so users can see what URL they're
// about to share. Hidden in production builds and in non-slide render contexts
// (overview / print / export).
const { currentSlideRoute, isPrintMode } = useNav()

const path = computed(() => {
  const route = currentSlideRoute.value
  if (!route)
    return ''
  return getSlidePath(route, false, false)
})

const absoluteUrl = computed(() => {
  const base = ((configs.publish as any)?.baseUrl as string | undefined)?.replace(/\/+$/, '')
    ?? (typeof location !== 'undefined' ? location.origin : '')
  return `${base}${path.value}`
})

const justCopied = ref(false)
async function copyUrl() {
  if (typeof navigator === 'undefined' || !navigator.clipboard)
    return
  try {
    await navigator.clipboard.writeText(absoluteUrl.value)
    justCopied.value = true
    setTimeout(() => {
      justCopied.value = false
    }, 1200)
  }
  catch {}
}
</script>

<template>
  <button
    v-if="__DEV__ && !isPrintMode && path"
    class="slugchip"
    :title="`Copy share URL (${absoluteUrl})`"
    @click="copyUrl"
  >
    <span class="slugchip-path">{{ path }}</span>
    <span class="slugchip-icon" :class="justCopied ? 'i-carbon:checkmark' : 'i-carbon:copy'" />
    <span v-if="justCopied" class="slugchip-flash">copied</span>
  </button>
</template>

<style scoped>
.slugchip {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 25;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 8px;
  background: rgb(0 0 0 / 0.55);
  color: #eee;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 3px;
  font:
    500 11px/1.3 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: auto;
}
#slide-container:hover .slugchip,
.slugchip:focus,
.slugchip:hover {
  opacity: 0.9;
}
.slugchip:hover {
  opacity: 1;
  border-color: rgb(105 153 255 / 0.6);
}
.slugchip-icon {
  font-size: 12px;
  opacity: 0.85;
}
.slugchip-flash {
  font-size: 10px;
  opacity: 0.85;
  color: #7be07b;
}
</style>
