import { onMounted, onUnmounted, ref } from 'vue'
import { uploadAndInsert } from './useImageInsert'
import { useNav } from './useNav'

const IMAGE_URL_RE = /\.(?:png|jpe?g|gif|webp|svg|avif)(?:\?.*)?$/i

function isImageOrVideoFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

function looksLikeImageUrl(s: string): boolean {
  try {
    const u = new URL(s.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
      return false
    return IMAGE_URL_RE.test(u.pathname)
  }
  catch {
    return false
  }
}

function inputContextActive(): boolean {
  const ae = document.activeElement
  if (!ae)
    return false
  if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement)
    return true
  if ((ae as HTMLElement).isContentEditable)
    return true
  return false
}

// Paste handler — Cmd+V (or Ctrl+V) with an image / video file on the
// clipboard uploads the file via the existing `/__slidev/upload` endpoint and
// appends `![](url)` to the current slide. URL pastes that look like image
// links append the same markdown without uploading (remote-hosted, hotlinked).
//
// Skipped when:
//   - An `<input>` / `<textarea>` / contentEditable element is focused (so
//     paste-into-input still works for slug-chip-style controls).
//   - Clipboard has neither image bytes nor a URL that looks like an image.
//
// Same upload pipeline + append-to-slide-source semantics as `useFileDrop`
// and the `i`-key image picker, so all three converge on the same source-line
// shape and `slides.coords.yaml` handling for the inserted element's eventual
// drag position.
export function usePasteImage() {
  const inFlight = ref(false)
  const error = ref<string | null>(null)
  const { currentSlideNo } = useNav()

  async function onPaste(ev: ClipboardEvent) {
    if (inputContextActive())
      return
    const dt = ev.clipboardData
    if (!dt)
      return

    // 1. File paste (screenshot, image from another app, etc.)
    const files = Array.from(dt.files ?? []).filter(isImageOrVideoFile)
    if (files.length > 0) {
      ev.preventDefault()
      inFlight.value = true
      error.value = null
      try {
        const no = currentSlideNo.value
        for (const file of files)
          await uploadAndInsert(file, no)
      }
      catch (e) {
        error.value = e instanceof Error ? e.message : String(e)

        console.error('[slidev] paste image failed:', e)
      }
      finally {
        inFlight.value = false
      }
      return
    }

    // 2. URL paste — only consume if it parses as a URL and the path ends in
    //    a common image extension. Otherwise let the paste flow through (e.g.
    //    pasting plain text into a focusable region that's not an input but
    //    might still have a paste handler).
    const text = dt.getData('text/plain')
    if (text && looksLikeImageUrl(text)) {
      ev.preventDefault()
      const { appendToSlide } = await import('./useImageInsert')
      try {
        await appendToSlide(currentSlideNo.value, `![](${text.trim()})`)
      }
      catch (e) {
        error.value = e instanceof Error ? e.message : String(e)

        console.error('[slidev] paste image URL failed:', e)
      }
    }
  }

  onMounted(() => {
    window.addEventListener('paste', onPaste)
  })
  onUnmounted(() => {
    window.removeEventListener('paste', onPaste)
  })

  return { inFlight, error }
}
