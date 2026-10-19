import { ref } from 'vue'

// The deck-level QR URL form chosen from a QR's hover popover this session. It's saved to the
// headmatter (`qr.url`) without HMR, since a headmatter change reloads the whole page; this
// applies it to every QR at once instead. Module state, so all `SlideQR`s share it.
export const deckQrUrlForm = ref<'n' | 'n-slug' | 'slug' | null>(null)
