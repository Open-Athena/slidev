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
// "moderate". Arrow length is sqrt-scaled so a 10-unit nudge is still visible while a
// 500-unit drag doesn't blow up the layout. The arrow is drawn through the center of the
// box (line spans -L/2..+L/2) and rotated around origin, so at max magnitude it occupies
// the full diameter — no wasted half-canvas.
const ARROW_BOX = 26
const ARROW_MAX = 22
const ARROW_REF = 100

const moveMag = computed(() => Math.hypot(props.dx ?? 0, props.dy ?? 0))
const moveAngle = computed(() => Math.atan2(props.dy ?? 0, props.dx ?? 0) * 180 / Math.PI)
const moveLen = computed(() => {
  const m = moveMag.value
  if (m <= 0)
    return 0
  return Math.min(ARROW_MAX, ARROW_MAX * Math.sqrt(m / ARROW_REF))
})
const halfLen = computed(() => moveLen.value / 2)

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
  <span class="inline-flex items-center gap-1.5 align-middle text-xs leading-none">
    <!-- Multi-item events render only an item count; per-element deltas would be too noisy. -->
    <template v-if="(itemCount ?? 1) > 1">
      <span class="opacity-60">{{ itemCount }} items</span>
    </template>

    <!-- Move: SVG arrow drawn diametrically (line spans the full canvas at max mag) and
         rotated around center. Arrowhead at the +tip; tail extends behind origin so the
         arrow stays visually centered in the box regardless of length. -->
    <template v-else-if="kind === 'move' && moveMag > 0.5">
      <svg :width="ARROW_BOX" :height="ARROW_BOX" :viewBox="`-${ARROW_BOX / 2} -${ARROW_BOX / 2} ${ARROW_BOX} ${ARROW_BOX}`" class="shrink-0">
        <g :transform="`rotate(${moveAngle})`">
          <line :x1="-halfLen" y1="0" :x2="halfLen" y2="0" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <polygon
            v-if="moveLen > 2"
            :points="`${halfLen},0 ${halfLen - 5},-3.5 ${halfLen - 5},3.5`"
            fill="currentColor"
          />
          <circle v-if="moveLen <= 2" cx="0" cy="0" r="2" fill="currentColor" />
        </g>
      </svg>
      <span class="opacity-60 tabular-nums">{{ Math.round(moveMag) }}</span>
    </template>

    <!-- Resize: ↗ for grow, ↙ for shrink, with absolute Δw×Δh -->
    <template v-else-if="kind === 'resize' && (dw !== 0 || dh !== 0)">
      <span class="text-base leading-none">{{ resizeSign > 0 ? '↗' : '↙' }}</span>
      <span class="opacity-60 tabular-nums">{{ Math.round(Math.abs(dw ?? 0)) }}×{{ Math.round(Math.abs(dh ?? 0)) }}</span>
    </template>

    <!-- Rotate: ↻ / ↺ + |°| -->
    <template v-else-if="kind === 'rotate' && (dDeg ?? 0) !== 0">
      <span class="text-base leading-none">{{ (dDeg ?? 0) > 0 ? '↻' : '↺' }}</span>
      <span class="opacity-60 tabular-nums">{{ Math.abs(Math.round(dDeg ?? 0)) }}°</span>
    </template>

    <!-- Z-order: ↑/↓ + |Δ| -->
    <template v-else-if="kind === 'zorder' && (dZ ?? 0) !== 0">
      <span class="text-base leading-none">{{ (dZ ?? 0) > 0 ? '↑' : '↓' }}</span>
      <span class="opacity-60 tabular-nums">{{ Math.abs(dZ ?? 0) }}</span>
    </template>

    <!-- Crop: list the changed edges (T/R/B/L). Empty crop event renders nothing. -->
    <template v-else-if="kind === 'crop' && cropEdges.length > 0">
      <span class="opacity-60 tabular-nums">{{ cropEdges.map(e => e[0].toUpperCase()).join('') }}</span>
    </template>
  </span>
</template>
