<script setup lang="ts">
import type { EditEvent } from '../composables/useDragHistory'
import { computed, ref, watch } from 'vue'
import {
  eventStreamVersion,
  fetchEvents,
  lastYamlCommitEventId,
  refreshHistoryState,
  restoreToEvent,
  topActiveEventId,
} from '../composables/useDragHistory'
import { showHistoryDrawer } from '../state'
import IconButton from './IconButton.vue'

const events = ref<EditEvent[]>([])
const loading = ref(false)
const restoringId = ref<number | null>(null)
const slideFilter = ref<number | null>(null)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const [, list] = await Promise.all([
      refreshHistoryState(),
      fetchEvents({ limit: 200, slideNo: slideFilter.value ?? undefined }),
    ])
    events.value = list
  }
  finally {
    loading.value = false
  }
}

watch(showHistoryDrawer, (open) => {
  if (open)
    void refresh()
})
watch(eventStreamVersion, () => {
  if (showHistoryDrawer.value)
    void refresh()
})
watch(slideFilter, () => {
  if (showHistoryDrawer.value)
    void refresh()
})

function classify(e: EditEvent): 'active' | 'undone' | 'abandoned' {
  if (e.abandonedAt !== null)
    return 'abandoned'
  if (e.undoneAt !== null)
    return 'undone'
  return 'active'
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.round(diff / 1000)
  if (s < 60)
    return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60)
    return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24)
    return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

const KIND_ICON: Record<string, string> = {
  move: 'i-carbon:move',
  resize: 'i-carbon:expand-categories',
  rotate: 'i-carbon:rotate',
  crop: 'i-carbon:crop',
  zorder: 'i-carbon:layers',
  restore: 'i-carbon:reset',
  hydrate: 'i-carbon:db2-database',
}

function summarize(e: EditEvent): string {
  if (e.items.length === 1)
    return `\`${e.items[0].dragId}\``
  return `${e.items.length} elements`
}

async function onRestoreClick(e: EditEvent) {
  restoringId.value = e.id
  try {
    await restoreToEvent(e.id)
  }
  finally {
    restoringId.value = null
  }
}

const slideOptions = computed<number[]>(() => {
  const set = new Set<number>()
  for (const e of events.value)
    set.add(e.slideNo)
  return Array.from(set).sort((a, b) => a - b)
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-x-full opacity-0"
    enter-to-class="translate-x-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-x-0 opacity-100"
    leave-to-class="translate-x-full opacity-0"
  >
    <aside
      v-if="showHistoryDrawer"
      class="fixed top-0 right-0 bottom-0 w-80 z-modal bg-main border-l border-main shadow-2xl flex flex-col"
    >
      <header class="flex items-center gap-2 px-3 py-2 border-b border-main">
        <div class="i-carbon:time-plot text-xl" />
        <h2 class="text-base font-semibold flex-auto">
          History
        </h2>
        <IconButton title="Refresh" @click="refresh()">
          <div class="i-carbon:renew" />
        </IconButton>
        <IconButton title="Close" @click="showHistoryDrawer = false">
          <div class="i-carbon:close" />
        </IconButton>
      </header>

      <div class="flex items-center gap-2 px-3 py-2 border-b border-main text-sm">
        <span class="opacity-70">Slide:</span>
        <select
          v-model="slideFilter"
          class="bg-transparent border border-main rounded px-1 py-0.5 text-xs"
        >
          <option :value="null">
            all
          </option>
          <option v-for="n in slideOptions" :key="n" :value="n">
            slide {{ n }}
          </option>
        </select>
        <span class="opacity-50 text-xs ml-auto">{{ events.length }} event{{ events.length === 1 ? '' : 's' }}</span>
      </div>

      <ol v-if="!loading && events.length > 0" class="flex-auto overflow-y-auto">
        <li
          v-for="e in events"
          :key="e.id"
          :data-event-id="e.id"
          class="border-b border-main border-opacity-50 px-3 py-2 text-sm"
          :class="{
            'opacity-60': classify(e) === 'undone',
            'opacity-30 line-through': classify(e) === 'abandoned',
            'bg-primary bg-opacity-10': e.id === topActiveEventId,
          }"
        >
          <div class="flex items-center gap-2">
            <div :class="KIND_ICON[e.kind] ?? 'i-carbon:edit'" class="text-base shrink-0" />
            <div class="flex-auto leading-tight">
              <div class="font-medium">
                <span>{{ e.kind }}</span>
                <span class="opacity-60"> · slide {{ e.slideNo }}</span>
              </div>
              <div class="text-xs opacity-70 truncate" v-html="summarize(e).replace(/`([^`]+)`/g, '<code class=&quot;font-mono&quot;>$1</code>')" />
            </div>
            <div class="text-xs opacity-50 shrink-0">
              {{ relTime(e.ts) }}
            </div>
          </div>
          <div class="flex items-center gap-2 mt-1 ml-7 text-xs">
            <span class="opacity-50">#{{ e.id }}</span>
            <span v-if="e.id === lastYamlCommitEventId" class="opacity-70" title="Last YAML commit">
              <div class="i-carbon:bookmark inline-block" />
            </span>
            <button
              v-if="classify(e) !== 'abandoned' && e.id !== topActiveEventId"
              class="ml-auto px-2 py-0.5 rounded bg-primary bg-opacity-15 hover:bg-opacity-25 disabled:opacity-50"
              :disabled="restoringId === e.id"
              @click="onRestoreClick(e)"
            >
              {{ restoringId === e.id ? 'Restoring…' : 'Restore' }}
            </button>
          </div>
        </li>
      </ol>
      <div v-else-if="loading" class="flex-auto flex items-center justify-center opacity-60 text-sm">
        Loading…
      </div>
      <div v-else class="flex-auto flex items-center justify-center opacity-60 text-sm">
        No events yet.
      </div>

      <footer class="px-3 py-2 border-t border-main text-xs opacity-60">
        Restoring inserts a new event so the action itself is undoable.
      </footer>
    </aside>
  </Transition>
</template>
