<script setup lang="ts">
const props = defineProps<{ keys: string }>()
const chars = [...props.keys]
</script>

<template>
  <kbd class="kbd-with-icons">
    <template v-for="(c, i) in chars" :key="i">
      <svg v-if="c === '⌘'" class="kbd-modifier" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v4H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2h4v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-4h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v2h-4V6a2 2 0 0 0-2-2H6zm4 6h4v4h-4v-4z" />
      </svg>
      <svg v-else-if="c === '⇧'" class="kbd-modifier kbd-modifier-wide" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 3L3 14h6v7h10v-7h6L14 3z" />
      </svg>
      <svg v-else-if="c === '↑'" class="kbd-key" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
      <svg v-else-if="c === '↓'" class="kbd-key" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
      <span v-else class="kbd-char">{{ c }}</span>
    </template>
  </kbd>
</template>

<style scoped>
/* Render children inline (not flex) so the kbd's baseline is the inside text's
   baseline — which naturally aligns with surrounding-text baseline. Icons get
   `vertical-align` individually so they sit at the x-height-ish midline, matching
   the surrounding text optically. */
.kbd-with-icons {
  display: inline-block;
  line-height: 1;
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  white-space: nowrap;
}
/* Force inline-block — browser/UnoCSS reset gives svg `display: block` by default,
   which would stack the icons vertically inside the kbd. */
.kbd-modifier,
.kbd-key {
  display: inline-block;
}
.kbd-modifier {
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.2em;
}
.kbd-modifier-wide {
  width: 1.25em;
}
.kbd-key {
  width: 0.95em;
  height: 0.95em;
  vertical-align: -0.15em;
}
.kbd-char {
  vertical-align: baseline;
}
</style>
