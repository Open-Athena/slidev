<!--
A simple wrapper for embedded Bluesky posts

Usage:

<BlueSky uri="at://did:plc:432mbsu2xucyvxl6sluohidu/app.bsky.feed.post/3lgwg2vy44s2q" />
<BlueSky uri="https://bsky.app/profile/sli.dev/post/3lgwg2vy44s2q" />
-->

<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, nextTick, onMounted, ref } from 'vue'
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

// BlueSky's iframe height is widget-driven and varies per post. Previously we
// tracked it with a ResizeObserver and pushed the AR into the v-drag
// lock-aspect-ratio, but that caused the wrapper to oscillate: the watcher
// auto-resized the wrapper to match content, but the saved `dragPos` stayed
// at the user-set dimensions, so every commit/sync round-trip (e.g. clicking
// Save → SSE broadcast → re-apply server state) would fight the watcher and
// the bb would visibly jump. No AR lock = the wrapper stays exactly where the
// user put it. Corner-resize free-scales (hold Shift to lock the current AR).

const loaded = ref(false)
const postNotFound = ref(false)
const resolvedUri = ref('')
const resolvedPostUrl = ref('')

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

onMounted(async () => {
  await create()
})
</script>

<template>
  <VDrag v-if="props.draggable !== false" :pos="bskyDragId">
    <div ref="wrapper" class="bluesky-fit">
      <div ref="container" class="slidev-bluesky" :style="innerStyle">
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
</style>

<style>
.slidev-bluesky .bluesky-embed iframe {
  border-radius: 12px;
  overflow: hidden;
}
</style>
