<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { formatShortcut } from '../logic/shortcut-display'
import { tooltipHidden, tooltipShowDelay } from '../logic/tooltip-group'

// Two root nodes (the button and the teleported tooltip): pass attrs / listeners to the button.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  title: string
  icon?: string
  as?: string
  to?: string
  disabled?: boolean
  active?: boolean
  /** Shortcut name(s) (see `setup/shortcuts.ts`) whose keys the tooltip shows. */
  shortcut?: string | string[]
}>()

const type = computed(() => props.as || (props.to ? 'router-link' : 'button'))
const keys = computed(() => formatShortcut(props.shortcut))

const el = ref<HTMLElement | { $el: HTMLElement } | null>(null)
const tip = ref<{ left: number, top: number, below: boolean } | null>(null)
const tipEl = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

function show() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const node = el.value && ('$el' in el.value ? el.value.$el : el.value)
    if (!node)
      return
    const rect = node.getBoundingClientRect()
    // Above the button, unless it's near the top of the window.
    const below = rect.top < 60
    tip.value = { left: rect.left + rect.width / 2, top: below ? rect.bottom + 6 : rect.top - 6, below }
    // Keep it inside the window (e.g. for the first / last toolbar buttons).
    void nextTick(() => {
      const width = tipEl.value?.offsetWidth
      if (!tip.value || !width)
        return
      const margin = 8
      tip.value.left = Math.min(Math.max(tip.value.left, width / 2 + margin), window.innerWidth - width / 2 - margin)
    })
  }, tooltipShowDelay())
}

function hide() {
  clearTimeout(timer)
  if (tip.value)
    tooltipHidden()
  tip.value = null
}

onBeforeUnmount(hide)
</script>

<template>
  <component
    :is="type"
    v-bind="$attrs"
    ref="el"
    class="slidev-icon-btn"
    :class="{ disabled, active }"
    :aria-label="title"
    :to="to"
    @pointerenter="show"
    @pointerleave="hide"
    @focus="show"
    @blur="hide"
    @click="hide"
  >
    <span class="sr-only">{{ title }}</span>
    <slot>
      <div :class="icon" />
    </slot>
  </component>
  <Teleport to="body">
    <div
      v-if="tip"
      ref="tipEl"
      class="slidev-tooltip"
      role="tooltip"
      :data-below="tip.below ? '' : undefined"
      :style="{ left: `${tip.left}px`, top: `${tip.top}px` }"
    >
      <span>{{ title }}</span>
      <kbd v-for="k in keys" :key="k">{{ k }}</kbd>
    </div>
  </Teleport>
</template>
