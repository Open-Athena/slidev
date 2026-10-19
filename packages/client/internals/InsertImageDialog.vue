<script setup lang="ts">
import type { EmbedKind } from '../composables/embed-insert'
import { computed, nextTick, ref, watch } from 'vue'
import { defaultPos, EMBED_SIZE, parseEmbed } from '../composables/embed-insert'
import { getDragElementsForPage } from '../composables/useDragElements'
import { uploadAndInsert } from '../composables/useImageInsert'
import { insertElements } from '../composables/useInsertElements'
import { useNav } from '../composables/useNav'
import { slideHeight, slideWidth } from '../env'
import { activeElement, showInsertImageDialog } from '../state'

// The `i` picker: upload image / video files, or embed a Tweet, YouTube video or Bluesky post by
// URL / id. Either way the markup is appended to the current slide as one undoable edit; embeds
// get a default position (centred, cascading) and end up selected.

type Tab = 'image' | EmbedKind

const TABS: { tab: Tab, label: string, placeholder?: string, invalid?: string }[] = [
  { tab: 'image', label: 'Image' },
  { tab: 'tweet', label: 'Tweet', placeholder: 'https://x.com/user/status/… or id', invalid: 'Not a post URL on x.com / twitter.com, or a numeric id' },
  { tab: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/watch?v=… or id', invalid: 'Not a YouTube video URL or 11-character id' },
  { tab: 'bluesky', label: 'Bluesky', placeholder: 'https://bsky.app/profile/…/post/… or at://…', invalid: 'Not a bsky.app post URL or at:// post URI' },
]

// Module-level, so the picker reopens on the last-used tab.
const tab = ref<Tab>('image')

const container = ref<HTMLDivElement>()
const fileInput = ref<HTMLInputElement>()
const urlInput = ref<HTMLInputElement>()
const pending = ref<File[]>([])
const url = ref('')
const inFlight = ref(false)
const error = ref<string | null>(null)

const { currentSlideNo } = useNav()

const totalBytes = computed(() => pending.value.reduce((sum, f) => sum + f.size, 0))
const tabInfo = computed(() => TABS.find(t => t.tab === tab.value)!)
const embed = computed(() => tab.value === 'image' ? null : parseEmbed(tab.value, url.value))
const invalid = computed(() => tab.value !== 'image' && !!url.value.trim() && !embed.value)
const canInsert = computed(() => !inFlight.value && (tab.value === 'image' ? pending.value.length > 0 : !!embed.value))

function close() {
  showInsertImageDialog.value = false
  // Focus left in the hidden URL field would keep shortcuts (`i`, ⌫, ⌘Z) disabled.
  if (container.value?.contains(document.activeElement))
    (document.activeElement as HTMLElement).blur()
}

function reset() {
  pending.value = []
  url.value = ''
  error.value = null
  if (fileInput.value)
    fileInput.value.value = ''
}

function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  pending.value = Array.from(input.files ?? [])
  error.value = null
}

function selectTab(next: Tab) {
  tab.value = next
  error.value = null
  if (next !== 'image')
    void nextTick(() => urlInput.value?.focus())
}

async function insertEmbed(no: number): Promise<void> {
  const { snippet, dragId } = embed.value!
  const existing = getDragElementsForPage(no)
  // Its id comes from the post / video, so a second copy on one slide would share it.
  if (existing.some(e => e.dragId === dragId))
    throw new Error(`Already on slide ${no} (${dragId})`)
  const [w, h] = EMBED_SIZE[tab.value as EmbedKind]
  await insertElements(no, [{ snippet, dragId, pos: defaultPos(w, h, slideWidth.value, slideHeight.value, existing.length) }])
}

async function commit() {
  if (!canInsert.value)
    return
  inFlight.value = true
  error.value = null
  try {
    const no = currentSlideNo.value
    if (tab.value === 'image')
      await uploadAndInsert(pending.value, no)
    else
      await insertEmbed(no)
    reset()
    close()
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    inFlight.value = false
  }
}

function formatBytes(n: number): string {
  if (n < 1024)
    return `${n} B`
  if (n < 1024 * 1024)
    return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

watch(showInsertImageDialog, (show) => {
  if (show) {
    reset()
    // Delayed so the `i` that opened the picker doesn't land in the URL field.
    setTimeout(() => tab.value === 'image' ? fileInput.value?.click() : urlInput.value?.focus(), 0)
  }
})

// Close when focus moves out of the picker. Only *out*: an embed's iframe loading elsewhere on the
// slide can take focus before the picker has it.
watch(activeElement, (el, prev) => {
  if (!showInsertImageDialog.value)
    return
  if (container.value?.contains(prev as Node) && !container.value.contains(el as Node))
    close()
})
</script>

<template>
  <div
    id="slidev-insert-image-dialog"
    ref="container"
    tabindex="-1"
    class="fixed right-5 transition-all"
    w-100 max-w-100 min-w-100
    :class="showInsertImageDialog ? 'top-5' : '-top-5 -translate-y-full op0 pointer-events-none'"
    @keydown.escape="close"
  >
    <div
      class="bg-main"
      shadow="~"
      p="x-4 y-3"
      border="~ transparent rounded dark:main"
    >
      <div class="flex gap-1 mb-3 text-sm" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.tab"
          role="tab"
          :aria-selected="tab === t.tab"
          :data-insert-tab="t.tab"
          class="px-2 py-0.5 rounded"
          :class="tab === t.tab ? 'bg-active op100' : 'op60 hover:op100'"
          @click="selectTab(t.tab)"
        >
          {{ t.label }}
        </button>
      </div>
      <template v-if="tab === 'image'">
        <div class="text-sm op-70 mb-2">
          Insert into slide {{ currentSlideNo }} → <code>public/images/</code>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*,video/*"
          multiple
          class="block w-full text-sm"
          @change="onFileChange"
        >
        <div v-if="pending.length" class="mt-3 text-sm">
          <ul class="max-h-32 overflow-y-auto">
            <li v-for="f in pending" :key="f.name" class="flex justify-between gap-3 op-80">
              <span class="truncate">{{ f.name }}</span>
              <span class="op-60 flex-shrink-0">{{ formatBytes(f.size) }}</span>
            </li>
          </ul>
          <div class="op-60 mt-1">
            {{ pending.length }} file(s), {{ formatBytes(totalBytes) }} total
          </div>
        </div>
      </template>
      <template v-else>
        <div class="text-sm op-70 mb-2">
          Embed in slide {{ currentSlideNo }}
        </div>
        <input
          ref="urlInput"
          v-model="url"
          type="text"
          data-insert-url
          class="block w-full text-sm bg-transparent border rounded px-2 py-1 outline-none"
          :class="invalid ? 'border-red-400' : 'border-main'"
          :placeholder="tabInfo.placeholder"
          spellcheck="false"
          autocomplete="off"
          @keydown.enter.prevent="commit"
        >
        <div v-if="invalid" class="mt-2 text-sm text-red-400" data-insert-invalid>
          {{ tabInfo.invalid }}
        </div>
        <code v-else-if="embed" class="block mt-2 text-xs op-70 truncate" data-insert-preview>{{ embed.snippet }}</code>
      </template>
      <div v-if="error" class="mt-2 text-sm text-red-400" data-insert-error>
        {{ error }}
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <button class="px-3 py-1 op-70 hover:op-100" @click="close">
          Cancel
        </button>
        <button
          class="px-3 py-1 bg-active rounded disabled:op-40"
          data-insert-commit
          :disabled="!canInsert"
          @click="commit"
        >
          {{ inFlight ? 'Inserting…' : tab === 'image' ? `Insert ${pending.length || ''}` : 'Embed' }}
        </button>
      </div>
    </div>
  </div>
</template>
