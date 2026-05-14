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
}>(), {
  url: undefined,
  position: undefined,
  size: undefined,
  showText: undefined,
  urlForm: undefined,
  ecc: undefined,
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
// (for `urlForm` only) deck-level `publish.canonicalForm` > built-in default.
// Plumbing `publish.canonicalForm` here keeps the QR target consistent with
// `<link rel=canonical>` / `og:url` / the URL bar after in-deck nav by default,
// while still letting decks point QRs at a different URL form if they want
// (e.g. canonical `/n-slug` but QR-scan `/n` for brevity).
const resolved = computed(() => {
  const canonical = (configs.publish as any)?.canonicalForm
  const canonicalUrlForm: UrlForm | undefined
    = canonical === 'n' || canonical === 'slug' || canonical === 'n-slug' ? canonical : undefined
  return {
    position: (props.position ?? slideQrCfg.value.position ?? deckQrCfg.value.position ?? 'br') as Position,
    size: (props.size ?? slideQrCfg.value.size ?? deckQrCfg.value.size ?? 80) as number,
    showText: props.showText ?? slideQrCfg.value.showText ?? deckQrCfg.value.showText ?? false,
    urlForm: (props.urlForm ?? slideQrCfg.value.url ?? deckQrCfg.value.url ?? canonicalUrlForm ?? 'canonical') as UrlForm,
    ecc: (props.ecc ?? slideQrCfg.value.ecc ?? deckQrCfg.value.ecc ?? 'M') as Ecc,
  }
})

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
  switch (resolved.value.urlForm) {
    case 'n': return String(no)
    case 'slug': return slug || String(no)
    case 'n-slug':
    case 'canonical':
    default: return slug ? `${no}-${slug}` : String(no)
  }
})

const targetUrl = computed(() => {
  if (props.url)
    return props.url
  return `${origin.value}/${slidePath.value}`
})

const svg = computed(() => renderSVG(targetUrl.value, { ecc: resolved.value.ecc }))

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
      {{ targetUrl }}
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
  font-size: 11px;
  opacity: 0.7;
  background: rgb(255 255 255 / 0.85);
  padding: 1px 4px;
  border-radius: 3px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slidev-qr-svg {
  background: white;
  padding: 4px;
  border-radius: 4px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.08);
}
.slidev-qr-svg :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
