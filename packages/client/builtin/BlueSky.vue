<!--
A simple wrapper for embedded Bluesky posts

Usage:

<BlueSky uri="at://did:plc:432mbsu2xucyvxl6sluohidu/app.bsky.feed.post/3lgwg2vy44s2q" />
<BlueSky uri="https://bsky.app/profile/sli.dev/post/3lgwg2vy44s2q" />
-->

<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { isDark } from '../logic/dark'
import VDrag from './VDrag.vue'

const props = withDefaults(defineProps<{
  uri: string
  scale?: string | number
  draggable?: boolean
}>(), {
  draggable: true,
})

// BlueSky's embed widget injects an iframe with `width: 100%; height: <dynamic>`
// based on post content. We mirror the Tweet pattern: render the blockquote at a
// fixed natural width and visually fit-to-wrapper via CSS transform, so a
// v-drag wrapper at arbitrary dims renders the post cleanly.
const BSKY_NATURAL_W = 550

// Stable dragId derived from the post id (last URL/at-URI segment). Falls back
// to a slugified uri if no recognizable post segment is present.
const bskyDragId = computed(() => {
  const m = props.uri.match(/(?:post|app\.bsky\.feed\.post)\/([^/?#]+)/)
  const slug = m?.[1] ?? props.uri.replace(/\W+/g, '-').replace(/^-+|-+$/g, '').slice(-32)
  return `bsky-${slug}`
})

const RE_BLUESKY_POST_URL = /^\/profile\/([^/]+)\/post\/([^/?#]+)$/

const container = ref<HTMLElement | null>(null)
const wrapper = ref<HTMLElement | null>(null)
const { width: wrapperWidth } = useElementSize(wrapper)
const fitScale = computed(() => wrapperWidth.value > 0 ? wrapperWidth.value / BSKY_NATURAL_W : 1)
const innerStyle = computed(() => ({
  width: `${BSKY_NATURAL_W}px`,
  transform: `scale(${fitScale.value})`,
  transformOrigin: 'top left',
}))

// BlueSky's iframe height is widget-driven and varies per post (a plain text
// post is ~70px, one with a quoted post + image can be 500+). Track iframe
// height in a ref so `bskyAR` recomputes when it changes. A previous round
// caused oscillation on yaml-commit broadcasts re-applying server state to a
// client whose lockAR watcher had drifted height locally — that path was fixed
// upstream by making yaml-commit skip the element-state sync.
const iframeHeight = ref(0)
let iframeResizeObserver: ResizeObserver | null = null
let widgetObserver: MutationObserver | null = null

function watchIframeAR(iframe: HTMLIFrameElement) {
  iframeResizeObserver?.disconnect()
  iframeResizeObserver = new ResizeObserver(() => {
    iframeHeight.value = iframe.offsetHeight
  })
  iframeResizeObserver.observe(iframe)
}

// Geometry-correct wrap AR.
//
// The v-drag container has `class="p-1"` (4 px padding all sides), so the
// inner usable area is `(wrap.W - 8) × (wrap.H - 8)`. The slot scales its
// 550-px-wide content to fit that inner area, so visible iframe height is
// `iframe.H × (wrap.W - 8) / 550`. For a tight fit we want
//     iframe.H × (wrap.W - 8) / 550 = wrap.H - 8
// which gives
//     wrap.H = 8 + iframe.H × (wrap.W - 8) / 550
// — an affine relation, NOT a pure ratio. Approximating it with a constant
// `lockAspectRatio = 550 / iframe.H` (the naive "iframe content AR") leaves
// ~3-8 px of clipping/whitespace depending on wrap width. Computing the
// instantaneous wrap AR from current wrapper width gives a clean fit at every
// width — the lockAR watcher will redrive height each time width changes.
//
// `wrapperWidth` from `useElementSize(.bluesky-fit)` already reports the
// padding-stripped inner width, so `wrap.W = wrapperWidth + 8`.
const bskyAR = computed(() => {
  const ih = iframeHeight.value
  const fitW = wrapperWidth.value
  if (ih <= 0 || fitW <= 0)
    return undefined
  const wrapW = fitW + 8
  const wrapH = 8 + ih * fitW / BSKY_NATURAL_W
  return wrapW / wrapH
})

const loaded = ref(false)
const postNotFound = ref(false)
const resolvedUri = ref('')
const resolvedPostUrl = ref('')

// Public bsky.app URL for the post. Used to surface a clickable link in the
// drag-control bar (DragControl picks up any `<a>` inside the dragged element
// via its `associatedLink` computed). For URL inputs we already store the
// canonical form during resolve; for at:// inputs we reconstruct from did/postId.
const RE_AT_POST_URI = /^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/
const postUrl = computed(() => {
  if (resolvedPostUrl.value)
    return resolvedPostUrl.value
  const m = props.uri.match(RE_AT_POST_URI)
  if (m)
    return `https://bsky.app/profile/${m[1]}/post/${m[2]}`
  if (props.uri.startsWith('http'))
    return props.uri
  return ''
})

const RESOLVE_HANDLE_URL = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle'
const GET_POST_THREAD_URL = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread'

interface BlueskyThreadResponse {
  thread?: {
    post?: {
      uri?: string
    }
  }
}

function scan(retries = 10) {
  // @ts-expect-error global
  if (!window.bluesky?.scan) {
    if (retries <= 0)
      console.error('Failed to load Bluesky embed widget after 10 retries.')
    if (retries <= 0)
      return
    setTimeout(scan, 1000, retries - 1)
    return
  }
  // @ts-expect-error global
  window.bluesky.scan(container.value || undefined)
}

function extractPostInfoFromUrl(input: string) {
  try {
    const url = new URL(input)
    const match = url.pathname.match(RE_BLUESKY_POST_URL)
    if (!match)
      return
    return {
      handle: decodeURIComponent(match[1]),
      postId: decodeURIComponent(match[2]),
      postUrl: url.toString(),
    }
  }
  catch {}
}

async function resolvePostUri(input: string) {
  try {
    if (input.startsWith('at://')) {
      resolvedUri.value = input
      resolvedPostUrl.value = ''
      return true
    }

    const info = extractPostInfoFromUrl(input)
    if (!info)
      return false

    const handleResponse = await fetch(`${RESOLVE_HANDLE_URL}?handle=${encodeURIComponent(info.handle)}`)
    if (!handleResponse.ok)
      return false
    const handleData = await handleResponse.json() as { did?: string }
    if (!handleData.did)
      return false

    const uri = `at://${handleData.did}/app.bsky.feed.post/${info.postId}`
    const threadResponse = await fetch(
      `${GET_POST_THREAD_URL}?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`,
    )
    if (!threadResponse.ok)
      return false

    const threadData = await threadResponse.json() as BlueskyThreadResponse
    const canonicalUri = threadData.thread?.post?.uri
    if (!canonicalUri)
      return false

    resolvedUri.value = canonicalUri
    resolvedPostUrl.value = info.postUrl
    return true
  }
  catch {
    return false
  }
}

async function create(retries = 10) {
  loaded.value = false
  postNotFound.value = false

  if (!resolvedUri.value) {
    const ok = await resolvePostUri(props.uri)
    if (!ok) {
      postNotFound.value = true
      loaded.value = true
      return
    }
  }

  await nextTick()

  // @ts-expect-error global
  if (!window.bluesky?.scan) {
    if (retries <= 0) {
      console.error('Failed to load Bluesky embed widget after 10 retries.')
      postNotFound.value = true
      loaded.value = true
      return
    }
    setTimeout(create, 1000, retries - 1)
    return
  }

  scan()
  loaded.value = true
}

function attachIframeObserver() {
  if (!container.value)
    return
  // Iframe may already be present (bluesky.scan() injects it synchronously in
  // some cases) — check first, else watch for it.
  const existing = container.value.querySelector('iframe')
  if (existing) {
    watchIframeAR(existing as HTMLIFrameElement)
    return
  }
  widgetObserver = new MutationObserver(() => {
    const iframe = container.value?.querySelector('iframe')
    if (iframe) {
      watchIframeAR(iframe)
      widgetObserver?.disconnect()
      widgetObserver = null
    }
  })
  widgetObserver.observe(container.value, { childList: true, subtree: true })
}

onMounted(async () => {
  await create()
  attachIframeObserver()
})

onUnmounted(() => {
  widgetObserver?.disconnect()
  widgetObserver = null
  iframeResizeObserver?.disconnect()
  iframeResizeObserver = null
})
</script>

<template>
  <VDrag v-if="props.draggable !== false" :pos="bskyDragId" :lock-aspect-ratio="bskyAR">
    <div ref="wrapper" class="bluesky-fit">
      <div ref="container" class="slidev-bluesky" :style="innerStyle">
        <blockquote
          v-if="resolvedUri"
          class="bluesky-embed"
          :data-bluesky-uri="resolvedUri"
          :data-bluesky-embed-color-mode="isDark ? 'dark' : 'light'"
        />
        <!-- Hidden anchor exposes the post URL to DragControl's `associatedLink`
             (which calls `el.querySelector('a')` on the v-drag container), so
             selecting the embed surfaces a clickable link in the control bar. -->
        <a v-if="postUrl" :href="postUrl" target="_blank" rel="noopener noreferrer" aria-hidden="true" class="bluesky-link" />
        <div v-if="!loaded || postNotFound" class="h-30 w-30 my-10px bg-gray-400 bg-opacity-10 rounded-lg flex opacity-50">
          <div class="m-auto animate-pulse text-4xl">
            <div class="i-simple-icons:bluesky" />
            <span v-if="postNotFound">Could not load Bluesky post</span>
          </div>
        </div>
      </div>
    </div>
  </VDrag>
  <Transform v-else :scale="scale || 1">
    <div ref="container" class="slidev-bluesky">
      <blockquote
        v-if="resolvedUri"
        class="bluesky-embed"
        :data-bluesky-uri="resolvedUri"
        :data-bluesky-embed-color-mode="isDark ? 'dark' : 'light'"
      />
      <div v-if="!loaded || postNotFound" class="h-30 w-30 my-10px bg-gray-400 bg-opacity-10 rounded-lg flex opacity-50">
        <div class="m-auto animate-pulse text-4xl">
          <div class="i-simple-icons:bluesky" />
          <span v-if="postNotFound">Could not load Bluesky post</span>
        </div>
      </div>
    </div>
  </Transform>
</template>

<style scoped>
.bluesky-fit {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
/* Anchor must exist in DOM for DragControl.associatedLink to find it via
   `querySelector('a')`, but visually invisible — it lives outside the embed's
   visible area and is not interactive. */
.bluesky-link {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
</style>

<style>
.slidev-bluesky .bluesky-embed iframe {
  border-radius: 12px;
  overflow: hidden;
}
/* Bluesky's widget creates `.bluesky-embed` as a flex container around the
   injected iframe. Defaults that need overriding inside our wrapper:
   - `margin: 10px 0`: collapses through `.slidev-bluesky` and pushes content
     ~10 px below the v-drag wrapper's top edge.
   - `height: <fixed px>`: clamps the iframe to 150 px or whatever the embed
     library most recently sized it to, even when the iframe's own inline
     `height` (set via postMessage from embed.bsky.app) wants to be larger.
     Without `height: auto` the rich content (quoted posts, link cards) gets
     clipped to the flex parent's height. */
.slidev-bluesky .bluesky-embed {
  margin: 0 !important;
  height: auto !important;
}
</style>
