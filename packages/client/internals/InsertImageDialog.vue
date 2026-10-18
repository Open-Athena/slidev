<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { uploadAndInsert } from '../composables/useImageInsert'
import { useNav } from '../composables/useNav'
import { activeElement, showInsertImageDialog } from '../state'

const container = ref<HTMLDivElement>()
const fileInput = ref<HTMLInputElement>()
const pending = ref<File[]>([])
const inFlight = ref(false)
const error = ref<string | null>(null)

const { currentSlideNo } = useNav()

const totalBytes = computed(() => pending.value.reduce((sum, f) => sum + f.size, 0))

function close() {
  showInsertImageDialog.value = false
}

function reset() {
  pending.value = []
  error.value = null
  if (fileInput.value)
    fileInput.value.value = ''
}

function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  pending.value = Array.from(input.files ?? [])
  error.value = null
}

async function commit() {
  if (!pending.value.length || inFlight.value)
    return
  inFlight.value = true
  error.value = null
  try {
    const no = currentSlideNo.value
    for (const file of pending.value)
      await uploadAndInsert(file, no)
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
    setTimeout(() => fileInput.value?.click(), 0)
  }
})

watch(activeElement, () => {
  if (!showInsertImageDialog.value)
    return
  if (!container.value?.contains(activeElement.value as Node))
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
    :class="showInsertImageDialog ? 'top-5' : '-top-40'"
    @keydown.escape="close"
  >
    <div
      class="bg-main"
      shadow="~"
      p="x-4 y-3"
      border="~ transparent rounded dark:main"
    >
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
      <div v-if="error" class="mt-2 text-sm text-red-400">
        {{ error }}
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <button class="px-3 py-1 op-70 hover:op-100" @click="close">
          Cancel
        </button>
        <button
          class="px-3 py-1 bg-active rounded disabled:op-40"
          :disabled="!pending.length || inFlight"
          @click="commit"
        >
          {{ inFlight ? 'Inserting…' : `Insert ${pending.length || ''}` }}
        </button>
      </div>
    </div>
  </div>
</template>
