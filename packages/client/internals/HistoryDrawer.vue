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
import EventDelta from './EventDelta.vue'
import IconButton from './IconButton.vue'

const events = ref<EditEvent[]>([])
const loading = ref(false)
const restoringId = ref<number | null>(null)
const slideFilter = ref<number | null>(null)
const expandedGroups = ref<Set<string>>(new Set())

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
}, { immediate: true })
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

function summarize(items: EditEvent['items']): string {
  if (items.length === 1)
    return `\`${items[0].dragId}\``
  return `${items.length} elements`
}

// Inputs to <EventDelta>. Keep this shape flat so the template can `v-bind` it directly.
interface DeltaProps {
  kind: string
  dx?: number
  dy?: number
  dw?: number
  dh?: number
  dDeg?: number
  dZ?: number
  cropTop?: boolean
  cropRight?: boolean
  cropBottom?: boolean
  cropLeft?: boolean
  itemCount?: number
}

function deltaFromBeforeAfter(
  kind: string,
  before: EditEvent['items'][number]['before'],
  after: EditEvent['items'][number]['after'],
): DeltaProps {
  // For restore / hydrate / mutations where before or after is null (element added or removed
  // from the slide between events), there's no meaningful delta to draw — fall through to the
  // empty descriptor and EventDelta renders nothing.
  if (!before || !after)
    return { kind }
  switch (kind) {
    case 'move':
    case 'restore':
      return { kind, dx: after.x0 - before.x0, dy: after.y0 - before.y0 }
    case 'resize':
      return { kind, dw: after.width - before.width, dh: after.height - before.height }
    case 'rotate':
      return { kind, dDeg: after.rotate - before.rotate }
    case 'zorder':
      return { kind, dZ: (after.zIndex ?? 0) - (before.zIndex ?? 0) }
    case 'crop':
      return {
        kind,
        cropTop: (after.cropTop ?? 0) !== (before.cropTop ?? 0),
        cropRight: (after.cropRight ?? 0) !== (before.cropRight ?? 0),
        cropBottom: (after.cropBottom ?? 0) !== (before.cropBottom ?? 0),
        cropLeft: (after.cropLeft ?? 0) !== (before.cropLeft ?? 0),
      }
    default:
      return { kind }
  }
}

// Per-event delta. Multi-item events render only an item count via EventDelta.
function eventDelta(e: EditEvent): DeltaProps {
  if (e.items.length !== 1)
    return { kind: e.kind, itemCount: e.items.length }
  const it = e.items[0]
  // For restore events, render as a "move" arrow so the user sees where the element jumped.
  const renderKind = e.kind === 'restore' ? 'move' : e.kind
  return deltaFromBeforeAfter(renderKind, it.before, it.after)
}

// Cumulative delta across an entire group: walk from the OLDEST event's `before` to the
// NEWEST event's `after`. Since our grouping is keyed on `(slideNo, kind, sorted dragIds)`,
// every event in the group shares the same set of items; for a single-item streak this is
// the net motion across the streak.
function groupDelta(g: EventGroup): DeltaProps {
  const newest = g.events[0]
  const oldest = g.events[g.events.length - 1]
  if (newest.items.length !== 1 || oldest.items.length !== 1)
    return { kind: newest.kind, itemCount: newest.items.length }
  const renderKind = newest.kind === 'restore' ? 'move' : newest.kind
  return deltaFromBeforeAfter(renderKind, oldest.items[0].before, newest.items[0].after)
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

// Coalesce consecutive events that share `(slideNo, kind, sorted dragIds)`. The result is
// either a single event (rendered flat) or a group with a count badge and an accordion of
// the underlying events. The group's lifecycle status (`active` / `undone` / `abandoned`)
// reflects the *most recent* (head) event in the group — that's what the user is most
// likely thinking about. Group restore restores to the OLDEST event in the run (i.e. the
// state right before that streak began), which matches "undo the whole streak in one shot".
interface EventGroup {
  // Stable identifier for `expandedGroups` membership and `:key` (uses head-event id, which
  // is the newest event in the group; this id stays the same if the streak extends since new
  // events are absorbed into the existing group rather than displacing the head).
  key: string
  // The (slideNo, kind, dragIds) tuple — used to merge contiguous events with the same shape.
  matchKey: string
  // Events stored in the same order as the source array (DESC = newest first).
  events: EditEvent[]
}

function matchKey(e: EditEvent): string {
  const ids = e.items.map(i => i.dragId).sort().join(',')
  return `${e.slideNo}:${e.kind}:${ids}`
}

const grouped = computed<EventGroup[]>(() => {
  const out: EventGroup[] = []
  let cur: EventGroup | null = null
  for (const e of events.value) {
    const k = matchKey(e)
    if (cur && cur.matchKey === k) {
      cur.events.push(e)
    }
    else {
      cur = { key: `g:${e.id}`, matchKey: k, events: [e] }
      out.push(cur)
    }
  }
  return out
})

function isExpanded(g: EventGroup): boolean {
  return expandedGroups.value.has(g.key)
}

// True when the current top-active event is one of this group's members. Used to keep the
// group header highlighted as the user undoes/redoes inside the streak.
function groupContainsTop(g: EventGroup): boolean {
  const top = topActiveEventId.value
  if (top === null)
    return false
  return g.events.some(e => e.id === top)
}
function toggleGroup(g: EventGroup): void {
  if (expandedGroups.value.has(g.key))
    expandedGroups.value.delete(g.key)
  else
    expandedGroups.value.add(g.key)
  // Trigger reactivity on Set
  expandedGroups.value = new Set(expandedGroups.value)
}

// Group-level "Restore" rolls back to the state BEFORE the entire streak — i.e. restore
// to the event immediately preceding the oldest member of the group. If there's no such
// preceding event (the group runs back to the start of history), restore to the oldest
// member itself, which has the same effect.
function groupRestoreTarget(g: EventGroup): number {
  const oldest = g.events[g.events.length - 1]
  // Look for the event *before* `oldest` in the full events list.
  const idx = events.value.findIndex(e => e.id === oldest.id)
  const prior = events.value[idx + 1]
  return prior?.id ?? oldest.id
}
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
      class="relative w-80 h-full max-h-screen bg-main border-l border-main shadow-2xl flex flex-col font-sans overflow-hidden"
      style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
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

      <ol v-if="!loading && grouped.length > 0" class="flex-auto overflow-y-auto">
        <template v-for="g in grouped" :key="g.key">
          <!-- Single-event group: render as a flat row, identical to the pre-grouping layout. -->
          <li
            v-if="g.events.length === 1"
            :data-event-id="g.events[0].id"
            class="border-b border-main border-opacity-50 px-3 py-2 text-sm"
            :class="{
              'opacity-60': classify(g.events[0]) === 'undone',
              'opacity-30 line-through': classify(g.events[0]) === 'abandoned',
              'bg-primary bg-opacity-10': g.events[0].id === topActiveEventId,
            }"
          >
            <div class="flex items-center gap-2">
              <div :class="KIND_ICON[g.events[0].kind] ?? 'i-carbon:edit'" class="text-base shrink-0" />
              <div class="flex-auto leading-tight">
                <div class="font-medium">
                  <span>{{ g.events[0].kind }}</span>
                  <span class="opacity-60"> · slide {{ g.events[0].slideNo }}</span>
                </div>
                <div class="text-xs opacity-70 truncate" v-html="summarize(g.events[0].items).replace(/`([^`]+)`/g, '<code class=&quot;font-mono&quot;>$1</code>')" />
              </div>
              <div class="text-xs opacity-50 shrink-0">
                {{ relTime(g.events[0].ts) }}
              </div>
            </div>
            <div class="flex items-center gap-2 mt-1 ml-7 text-xs">
              <span class="opacity-50">#{{ g.events[0].id }}</span>
              <EventDelta v-bind="eventDelta(g.events[0])" />
              <span v-if="g.events[0].id === lastYamlCommitEventId" class="opacity-70" title="Last YAML commit">
                <div class="i-carbon:bookmark inline-block" />
              </span>
              <button
                v-if="classify(g.events[0]) !== 'abandoned' && g.events[0].id !== topActiveEventId"
                class="ml-auto px-2 py-0.5 rounded bg-primary bg-opacity-15 hover:bg-opacity-25 disabled:opacity-50"
                :disabled="restoringId === g.events[0].id"
                @click="onRestoreClick(g.events[0])"
              >
                {{ restoringId === g.events[0].id ? 'Restoring…' : 'Restore' }}
              </button>
            </div>
          </li>

          <!-- Multi-event group: collapsible card with a count badge. Click anywhere in the
               header to expand/collapse. Expanded view shows individual events with their
               own Restore buttons. -->
          <li
            v-else
            :data-group-key="g.key"
            class="border-b border-main border-opacity-50 text-sm"
          >
            <button
              type="button"
              class="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-primary hover:bg-opacity-5"
              :class="{
                'opacity-60': classify(g.events[0]) === 'undone',
                'opacity-30': classify(g.events[0]) === 'abandoned',
                // Keep the group header highlighted whenever the current top falls
                // anywhere inside the streak — otherwise undoing from the head step into
                // the middle of an expanded group makes the group itself look unfocused.
                'bg-primary bg-opacity-10': groupContainsTop(g),
              }"
              @click="toggleGroup(g)"
            >
              <div
                class="i-carbon:chevron-right text-sm shrink-0 transition-transform"
                :class="{ 'rotate-90': isExpanded(g) }"
              />
              <div :class="KIND_ICON[g.events[0].kind] ?? 'i-carbon:edit'" class="text-base shrink-0" />
              <div class="flex-auto leading-tight">
                <div class="font-medium">
                  <span>{{ g.events[0].kind }}</span>
                  <span class="opacity-60"> × {{ g.events.length }}</span>
                  <span class="opacity-60"> · slide {{ g.events[0].slideNo }}</span>
                </div>
                <div class="text-xs opacity-70 truncate" v-html="summarize(g.events[0].items).replace(/`([^`]+)`/g, '<code class=&quot;font-mono&quot;>$1</code>')" />
              </div>
              <div class="text-xs opacity-50 shrink-0">
                {{ relTime(g.events[0].ts) }}
              </div>
            </button>
            <div class="flex items-center gap-2 px-3 pb-2 ml-7 text-xs">
              <span class="opacity-50">#{{ g.events[g.events.length - 1].id }}–#{{ g.events[0].id }}</span>
              <EventDelta v-bind="groupDelta(g)" :title="`Cumulative across ${g.events.length} ${g.events[0].kind}s`" />
              <button
                v-if="classify(g.events[0]) !== 'abandoned' && groupRestoreTarget(g) !== topActiveEventId"
                class="ml-auto px-2 py-0.5 rounded bg-primary bg-opacity-15 hover:bg-opacity-25 disabled:opacity-50"
                :disabled="restoringId === groupRestoreTarget(g)"
                :title="`Restore to before this streak (event #${groupRestoreTarget(g)})`"
                @click="onRestoreClick({ ...g.events[0], id: groupRestoreTarget(g) })"
              >
                Restore all
              </button>
            </div>
            <ol v-if="isExpanded(g)" class="bg-gray-500 bg-opacity-5">
              <li
                v-for="e in g.events"
                :key="e.id"
                :data-event-id="e.id"
                class="px-3 py-1.5 ml-7 mr-2 text-xs flex items-center gap-2 border-l border-main border-opacity-30"
                :class="{
                  'opacity-60': classify(e) === 'undone',
                  'opacity-30 line-through': classify(e) === 'abandoned',
                  // Highlight the inner step that's currently the top-active event so the
                  // user can see exactly where they are in the streak when undoing/redoing.
                  'bg-primary bg-opacity-15 !border-primary border-opacity-60': e.id === topActiveEventId,
                }"
              >
                <span class="opacity-50">#{{ e.id }}</span>
                <span class="opacity-50">{{ relTime(e.ts) }}</span>
                <EventDelta v-bind="eventDelta(e)" />
                <span v-if="e.id === lastYamlCommitEventId" class="opacity-70" title="Last YAML commit">
                  <div class="i-carbon:bookmark inline-block" />
                </span>
                <button
                  v-if="classify(e) !== 'abandoned' && e.id !== topActiveEventId"
                  class="ml-auto px-2 py-0.5 rounded bg-primary bg-opacity-10 hover:bg-opacity-20 disabled:opacity-50"
                  :disabled="restoringId === e.id"
                  @click="onRestoreClick(e)"
                >
                  {{ restoringId === e.id ? 'Restoring…' : 'Restore' }}
                </button>
              </li>
            </ol>
          </li>
        </template>
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
