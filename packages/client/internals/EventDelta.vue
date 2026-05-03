<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  kind: string
  // Move
  dx?: number
  dy?: number
  // Resize
  dw?: number
  dh?: number
  // Rotate
  dDeg?: number
  // Z-order
  dZ?: number
  // Crop — booleans for the four edges
  cropTop?: boolean
  cropRight?: boolean
  cropBottom?: boolean
  cropLeft?: boolean
  // Multi-item / fallback
  itemCount?: number
}>()

// Slide units are roughly 0..980 across the default 16:9 slide; a 100-unit drag is
// "moderate". We cap arrow length at ARROW_MAX so the icon stays compact regardless
// of magnitude, but use sqrt scaling so small nudges are still visible (a 10-unit
// nudge isn't a single pixel) while a 500-unit drag doesn't blow up the layout.
const ARROW_BOX = 16
const ARROW_MAX = 7
const ARROW_REF = 100

const moveMag = computed(() => Math.hypot(props.dx ?? 0, props.dy ?? 0))
const moveAngle = computed(() => Math.atan2(props.dy ?? 0, props.dx ?? 0) * 180 / Math.PI)
const moveLen = computed(() => {
  const m = moveMag.value
  if (m <= 0)
    return 0
  return Math.min(ARROW_MAX, ARROW_MAX * Math.sqrt(m / ARROW_REF))
})

const resizeSign = computed(() => {
  const dw = props.dw ?? 0
  const dh = props.dh ?? 0
  if (dw === 0 && dh === 0)
    return 0
  return (dw + dh) > 0 ? 1 : -1
})

const cropEdges = computed<('top' | 'right' | 'bottom' | 'left')[]>(() => {
  const out: ('top' | 'right' | 'bottom' | 'left')[] = []
  if (props.cropTop)
    out.push('top')
  if (props.cropRight)
    out.push('right')
  if (props.cropBottom)
    out.push('bottom')
  if (props.cropLeft)
    out.push('left')
  return out
})
</script>

<template>
  <span class="inline-flex items-center gap-1 align-middle font-mono text-[10px] leading-none">
    <!-- Multi-item events render only an item count; per-element deltas would be too noisy. -->
    <template v-if="(itemCount ?? 1) > 1">
      <span class="opacity-60">{{ itemCount }} items</span>
    </template>

    <!-- Move: small SVG arrow rotated to direction; length scales with √magnitude up to ARROW_MAX. -->
    <template v-else-if="kind === 'move' && moveMag > 0.5">
      <svg :width="ARROW_BOX" :height="ARROW_BOX" :viewBox="`-${ARROW_BOX / 2} -${ARROW_BOX / 2} ${ARROW_BOX} ${ARROW_BOX}`" class="shrink-0">
        <g :transform="`rotate(${moveAngle})`">
          <line x1="0" y1="0" :x2="moveLen" y2="0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          <polygon
            v-if="moveLen > 1"
            :points="`${moveLen},0 ${Math.max(0, moveLen - 2.5)},-1.6 ${Math.max(0, moveLen - 2.5)},1.6`"
            fill="currentColor"
          />
          <circle v-if="moveLen <= 1" cx="0" cy="0" r="1.2" fill="currentColor" />
        </g>
      </svg>
      <span class="opacity-50">{{ Math.round(moveMag) }}</span>
    </template>

    <!-- Resize: ↗ for grow, ↙ for shrink, with absolute Δw×Δh -->
    <template v-else-if="kind === 'resize' && (dw !== 0 || dh !== 0)">
      <span class="text-sm leading-none">{{ resizeSign > 0 ? '↗' : '↙' }}</span>
      <span class="opacity-60">{{ Math.round(Math.abs(dw ?? 0)) }}×{{ Math.round(Math.abs(dh ?? 0)) }}</span>
    </template>

    <!-- Rotate: ↻ / ↺ + |°| -->
    <template v-else-if="kind === 'rotate' && (dDeg ?? 0) !== 0">
      <span class="text-sm leading-none">{{ (dDeg ?? 0) > 0 ? '↻' : '↺' }}</span>
      <span class="opacity-60">{{ Math.abs(Math.round(dDeg ?? 0)) }}°</span>
    </template>

    <!-- Z-order: ↑/↓ + |Δ| -->
    <template v-else-if="kind === 'zorder' && (dZ ?? 0) !== 0">
      <span class="text-sm leading-none">{{ (dZ ?? 0) > 0 ? '↑' : '↓' }}</span>
      <span class="opacity-60">{{ Math.abs(dZ ?? 0) }}</span>
    </template>

    <!-- Crop: list the changed edges (T/R/B/L). Empty crop event renders nothing. -->
    <template v-else-if="kind === 'crop' && cropEdges.length > 0">
      <span class="opacity-60">{{ cropEdges.map(e => e[0].toUpperCase()).join('') }}</span>
    </template>
  </span>
</template>
