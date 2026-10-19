<script setup lang="ts">
import { renderSVG } from 'uqr'
import { computed, ref } from 'vue'
import { useSlideContext } from '../context'
import { configs } from '../env'
import { deckQrUrlForm } from '../logic/qr-form'
import { getSlide, slugForSlide } from '../logic/slides'
import { editMode } from '../state'

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
  urlForm: (props.urlForm ?? slideQrCfg.value.url ?? deckQrUrlForm.value ?? deckQrCfg.value.url ?? 'n') as UrlForm,
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

// `'canonical'` means "follow the deck's `publish.canonicalForm`" — useful when a deck explicitly
// wants the QR to match share/scrape canonical URL rather than the chunky-QR default.
const urlForm = computed<Exclude<UrlForm, 'canonical'>>(() => {
  const form = resolved.value.urlForm
  if (form !== 'canonical')
    return form
  const c = (configs.publish as any)?.canonicalForm
  return (c === 'n' || c === 'slug' || c === 'n-slug') ? c : 'n-slug'
})

function pathFor(form: Exclude<UrlForm, 'canonical'>): string {
  const no = $page.value
  const slug = slugForSlide(getSlide(no))
  switch (form) {
    case 'n': return String(no)
    case 'slug': return slug || String(no)
    case 'n-slug':
    default: return slug ? `${no}-${slug}` : String(no)
  }
}

const slidePath = computed(() => pathFor(urlForm.value))

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

// Hover: show the encoded URL. In dev + edit mode, also offer the URL forms, which write the
// deck's `qr.url`: the number alone is the shortest (chunkiest QR) but goes stale when slides
// are inserted before this one; a slug keeps pointing at this slide (`/<n>-<slug>` resolves by
// slug first).
const hovered = ref(false)
const forms = computed(() => (['n', 'n-slug', 'slug'] as const)
  .map(form => ({ form, path: `/${pathFor(form)}` }))
  .filter((f, i, all) => all.findIndex(g => g.path === f.path) === i))
const canEditForm = computed(() => __DEV__ && editMode.value && !props.url)

async function setDeckUrlForm(form: Exclude<UrlForm, 'canonical'>) {
  deckQrUrlForm.value = form
  const res = await fetch('/__slidev/slides/1.json')
  if (!res.ok)
    throw new Error(`Failed to fetch the headmatter (${res.status})`)
  const { frontmatter } = await res.json() as { frontmatter: Record<string, unknown> }
  const qr = typeof frontmatter.qr === 'object' && frontmatter.qr !== null ? frontmatter.qr : {}
  const post = await fetch('/__slidev/slides/1.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    // `skipHmr`: a headmatter change would reload the page; `deckQrUrlForm` applies it in place.
    body: JSON.stringify({ frontmatter: { qr: { ...qr, url: form } }, skipHmr: true }),
  })
  if (!post.ok)
    throw new Error(`Failed to save \`qr.url\` (${post.status})`)
}
</script>

<template>
  <div
    v-if="!disabled"
    class="slidev-qr"
    :style="positionStyle"
    :data-position="resolved.position"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
  >
    <div v-if="hovered" class="slidev-qr-pop" @pointerdown.stop @click.stop>
      <div class="slidev-qr-pop-url">
        {{ displayUrl }}
      </div>
      <div v-if="canEditForm" class="slidev-qr-pop-forms">
        <button
          v-for="f in forms"
          :key="f.form"
          :data-active="f.form === urlForm ? '' : undefined"
          :title="f.form === 'n' ? 'Shortest; goes stale if slides are inserted before this one' : 'Follows this slide when slides are inserted or removed'"
          @click="setDeckUrlForm(f.form)"
        >
          {{ f.path }}
        </button>
      </div>
    </div>
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
.slidev-qr-pop {
  position: absolute;
  bottom: calc(100% + 6px);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgb(17 24 39 / 0.92);
  color: white;
  font:
    11px/1.4 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
  user-select: text;
}
/* Bridge the gap to the QR, so moving the pointer onto the popover keeps it open. */
.slidev-qr-pop::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 8px;
}
.slidev-qr[data-position^='t'] .slidev-qr-pop::after {
  top: auto;
  bottom: 100%;
}
.slidev-qr[data-position^='t'] .slidev-qr-pop {
  top: calc(100% + 6px);
  bottom: auto;
}
.slidev-qr[data-position$='r'] .slidev-qr-pop {
  right: 0;
}
.slidev-qr[data-position$='l'] .slidev-qr-pop {
  left: 0;
}
.slidev-qr-pop-forms {
  display: flex;
  gap: 4px;
}
.slidev-qr-pop-forms button {
  padding: 1px 6px;
  border: 1px solid rgb(255 255 255 / 0.3);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  opacity: 0.75;
}
.slidev-qr-pop-forms button:hover {
  opacity: 1;
}
.slidev-qr-pop-forms button[data-active] {
  border-color: rgb(96 165 250);
  background: rgb(59 130 246 / 0.35);
  opacity: 1;
}
.slidev-qr-svg :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
