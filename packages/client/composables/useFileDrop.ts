import { onMounted, onUnmounted, ref } from 'vue'
import { uploadAndInsert } from './useImageInsert'
import { useNav } from './useNav'

const ACCEPTED_TYPE_PREFIXES = ['image/', 'video/']

function eventCarriesFiles(ev: DragEvent): boolean {
  return Array.from(ev.dataTransfer?.types ?? []).includes('Files')
}

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_TYPE_PREFIXES.some(p => file.type.startsWith(p))
}

function targetWithinSlideContainer(ev: DragEvent): boolean {
  const target = ev.target as Element | null
  return !!target?.closest('#slide-container')
}

export function useFileDrop() {
  const dropActive = ref(false)
  const inFlight = ref(false)
  const error = ref<string | null>(null)

  const { currentSlideNo } = useNav()

  // dragenter/dragleave fire for every child traversal — track depth so we
  // only flip dropActive on the outermost transitions.
  let depth = 0

  function onDragEnter(ev: DragEvent) {
    if (!eventCarriesFiles(ev))
      return
    depth++
    dropActive.value = true
  }

  function onDragLeave(ev: DragEvent) {
    if (!eventCarriesFiles(ev))
      return
    depth = Math.max(0, depth - 1)
    if (depth === 0)
      dropActive.value = false
  }

  function onDragOver(ev: DragEvent) {
    if (!eventCarriesFiles(ev))
      return
    ev.preventDefault()
    if (ev.dataTransfer)
      ev.dataTransfer.dropEffect = targetWithinSlideContainer(ev) ? 'copy' : 'none'
  }

  async function onDrop(ev: DragEvent) {
    if (!eventCarriesFiles(ev))
      return
    ev.preventDefault()
    depth = 0
    dropActive.value = false
    if (!targetWithinSlideContainer(ev))
      return
    const files = Array.from(ev.dataTransfer?.files ?? []).filter(isAcceptedFile)
    if (!files.length)
      return
    inFlight.value = true
    error.value = null
    try {
      const no = currentSlideNo.value
      for (const file of files)
        await uploadAndInsert(file, no)
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[slidev] file drop failed:', e)
    }
    finally {
      inFlight.value = false
    }
  }

  onMounted(() => {
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
  })

  onUnmounted(() => {
    window.removeEventListener('dragenter', onDragEnter)
    window.removeEventListener('dragleave', onDragLeave)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('drop', onDrop)
  })

  return { dropActive, inFlight, error }
}
