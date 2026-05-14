<script setup lang="ts">
import { renderSVG } from 'uqr'
import { computed } from 'vue'
import { useSlideContext } from '../context'
import { configs } from '../env'
import { getSlide, slugForSlide } from '../logic/slides'

type Position = 'tl' | 'tr' | 'bl' | 'br'
type UrlForm = 'canonical' | 'n' | 'slug' | 'n-slug'
type Ecc = 'L' | 'M' | 'Q' | 'H'

// `withDefaults` with all-undefined defaults so optional boolean / numeric props
// stay `undefined` when not passed — Vue otherwise casts missing booleans to
// `false`, which would defeat the `props.x ?? deckConfig.x ?? default` fallback
// chain (false isn't nullish).
const props = withDefaults(defineProps<{
  /**
   * Explicit URL to encode. When set, all auto-resolution (baseUrl + slide
   * path) is bypassed — useful for QR codes pointing at unrelated targets
   * (linkedin, demo repo, etc.) rather than the current slide.
   */
  url?: string
  /** Corner placement. Default: deck-level `qr.position`, else `'br'`. */
  position?: Position
  /** QR size in slide-space px. Default: deck-level `qr.size`, else 80. */
  size?: number
  /** Show the URL as plain text above the QR. Default: deck-level `qr.showText`, else `false`. */
  showText?: boolean
  /**
   * URL form for the auto-derived target. `'canonical'` and `'n-slug'` both
   * produce `/<n>-<slug>`. Default: deck-level `qr.url`, else `'canonical'`.
   */
  urlForm?: UrlForm
  /**
   * Error correction level — higher = larger code, more resilient to occlusion.
   * Default: deck-level `qr.ecc`, else `'M'`.
   */
  ecc?: Ecc
  /**
   * Uppercase the encoded URL. QR's alphanumeric mode encodes `0-9 A-Z $%*+-./:`
   * (no lowercase) at 5.5 bits/char vs byte mode's 8 bits/char — for URLs that
   * are otherwise alphanumeric, an all-caps version drops a QR version or two
   * (chunkier, easier-to-scan pixels at a given visual size). Caveat: only safe
   * when the path itself is case-insensitive — works for `urlForm: 'n'` (digits
   * only) but breaks slug routes unless the server normalizes case.
   */
  uppercase?: boolean
}>(), {
  url: undefined,
  position: undefined,
  size: undefined,
  showText: undefined,
  urlForm: undefined,
  ecc: undefined,
  uppercase: undefined,
})

const { $page, $frontmatter } = useSlideContext()

// Merge config: deck-level `qr:` headmatter, per-slide `qr:` frontmatter,
// explicit prop overrides. Per-slide can also disable entirely via `qr: false`
// or `qr: 'none'`.
const slideQrCfg = computed(() => {
  const v = $frontmatter?.qr
  if (v === false || v === 'none')
    return { disabled: true } as const
  return (typeof v === 'object' && v !== null) ? v as Record<string, any> : {}
})
const deckQrCfg = computed(() => {
  const v = (configs as any).qr
  return (typeof v === 'object' && v !== null) ? v as Record<string, any> : {}
})

// Resolution order: explicit prop > per-slide `qr:` > deck-level `qr:` >
// built-in default. The QR target defaults to `'n'` (shortest URL form → fewest
// QR modules → chunkier, easier-to-scan pixels at a given visual size); set
// `qr.url: canonical` (or `'n-slug'` / `'slug'`) to follow `publish.canonicalForm`
// instead. ECC defaults to `'L'` (smallest QR version) — the QR is shown on a
// clean digital slide, not a printed handout, so the extra error correction
// doesn't earn its size cost.
const resolved = computed(() => ({
  position: (props.position ?? slideQrCfg.value.position ?? deckQrCfg.value.position ?? 'br') as Position,
  size: (props.size ?? slideQrCfg.value.size ?? deckQrCfg.value.size ?? 96) as number,
  showText: props.showText ?? slideQrCfg.value.showText ?? deckQrCfg.value.showText ?? false,
  urlForm: (props.urlForm ?? slideQrCfg.value.url ?? deckQrCfg.value.url ?? 'n') as UrlForm,
  ecc: (props.ecc ?? slideQrCfg.value.ecc ?? deckQrCfg.value.ecc ?? 'L') as Ecc,
  uppercase: props.uppercase ?? slideQrCfg.value.uppercase ?? deckQrCfg.value.uppercase ?? false,
}))

// In dev, location.origin is the right base (e.g. http://localhost:3282). In
// prod, `publish.baseUrl` is the canonical absolute URL. Fall back to
// location.origin in dev / when baseUrl unset (the QR still works locally; it
// just won't survive being scanned off a deployed render).
const origin = computed(() => {
  const b = (configs.publish as any)?.baseUrl
  if (typeof b === 'string' && b)
    return b.replace(/\/+$/, '')
  if (typeof location !== 'undefined')
    return location.origin
  return ''
})

const slidePath = computed(() => {
  const no = $page.value
  const slide = getSlide(no)
  const slug = slugForSlide(slide)
  let form: UrlForm = resolved.value.urlForm
  if (form === 'canonical') {
    // `'canonical'` means "follow the deck's `publish.canonicalForm`" — useful
    // when a deck explicitly wants the QR to match share/scrape canonical URL
    // rather than the chunky-QR default.
    const c = (configs.publish as any)?.canonicalForm
    form = (c === 'n' || c === 'slug' || c === 'n-slug') ? c : 'n-slug'
  }
  switch (form) {
    case 'n': return String(no)
    case 'slug': return slug || String(no)
    case 'n-slug':
    default: return slug ? `${no}-${slug}` : String(no)
  }
})

const targetUrl = computed(() => {
  if (props.url)
    return props.url
  return `${origin.value}/${slidePath.value}`
})

// Final encoded payload — uppercase when configured so the encoder can use
// alphanumeric mode (5.5 bits/char) instead of byte mode (8 bits/char) for the
// whole URL. Display label uses the same casing as the encoded payload so what
// you see matches what the scanner decodes.
const encodedUrl = computed(() => resolved.value.uppercase ? targetUrl.value.toUpperCase() : targetUrl.value)

// Display label strips the protocol — `slidev.oa.dev/3` reads more naturally
// in the QR caption than `https://slidev.oa.dev/3`, and the scheme is implicit
// once the QR is scanned anyway.
const displayUrl = computed(() => encodedUrl.value.replace(/^https?:\/\//i, ''))

const svg = computed(() => renderSVG(encodedUrl.value, { ecc: resolved.value.ecc, border: 1 }))

const positionStyle = computed(() => {
  const p = resolved.value.position
  // 16px from each edge — clear of typical slide padding without crowding the corner.
  const s: Record<string, string> = { position: 'absolute' }
  if (p[0] === 't')
    s.top = '16px'
  else
    s.bottom = '16px'
  if (p[1] === 'l')
    s.left = '16px'
  else
    s.right = '16px'
  return s
})

const disabled = computed(() => slideQrCfg.value.disabled === true)
</script>

<template>
  <div
    v-if="!disabled"
    class="slidev-qr"
    :style="positionStyle"
    :data-position="resolved.position"
  >
    <div v-if="resolved.showText" class="slidev-qr-url">
      {{ displayUrl }}
    </div>
    <div
      class="slidev-qr-svg"
      :style="{ width: `${resolved.size}px`, height: `${resolved.size}px` }"
      v-html="svg"
    />
  </div>
</template>

<style scoped>
.slidev-qr {
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  pointer-events: auto;
}
.slidev-qr[data-position$='l'] {
  align-items: flex-start;
}
.slidev-qr-url {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  opacity: 0.55;
  /* Inherit slide foreground; no background — let it sit on the slide instead
     of looking like a stuck-on label. Truncate gracefully if the path grows. */
  color: inherit;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slidev-qr-svg {
  /* No extra padding — `uqr` already renders a 2-module quiet zone (via the
     `border: 2` option), and stacking CSS padding on top of that creates the
     fat double-border the earlier version had. */
  background: white;
  border-radius: 3px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.08);
  overflow: hidden;
}
.slidev-qr-svg :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
