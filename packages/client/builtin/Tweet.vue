<!--
A simple wrapper for embedded Tweet

Usage:

<Tweet id="20" />
-->

<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isDark } from '../logic/dark'
import VDrag from './VDrag.vue'

const props = withDefaults(defineProps<{
  id: string | number
  scale?: string | number
  conversation?: string
  cards?: 'hidden' | 'visible'
  draggable?: boolean
}>(), {
  draggable: true,
})

// Twitter's embedded widget lays out its content for a specific pixel width
// (passed via createTweet's `width` option). When the wrapper is smaller than
// that, content overflows the right edge. To fit cleanly, render at a fixed
// natural width and visually scale via CSS transform to match the wrapper.
const TWEET_NATURAL_W = 550

const tweet = ref<HTMLElement | null>()
const wrapper = ref<HTMLElement | null>(null)
const { width: wrapperWidth } = useElementSize(wrapper)
const fitScale = computed(() => wrapperWidth.value > 0 ? wrapperWidth.value / TWEET_NATURAL_W : 1)
const tweetStyle = computed(() => ({
  width: `${TWEET_NATURAL_W}px`,
  transform: `scale(${fitScale.value})`,
  transformOrigin: 'top left',
}))

// Twitter's widget self-determines iframe height based on tweet content (and updates
// via postMessage). Compute `tweetAR` from that height so corner-resize preserves
// the natural shape. See BlueSky.vue for the geometry derivation; the short
// version is that the v-drag wrapper has 8 px of padding (`class="p-1"`), so the
// "natural wrap AR" isn't just `iframe.W / iframe.H` — it's
//   (fitW + 8) / (8 + iframe.H × fitW / 550)
// where `fitW` is the inner (padding-stripped) width. Using a constant AR ratio
// like `550 / iframeH` leaves a visible gap below the tweet at typical widths.
const iframeHeight = ref(0)

const tweetAR = computed(() => {
  const ih = iframeHeight.value
  const fitW = wrapperWidth.value
  if (ih <= 0 || fitW <= 0)
    return undefined
  return (fitW + 8) / (8 + ih * fitW / TWEET_NATURAL_W)
})

const loaded = ref(false)
const tweetNotFound = ref(false)

// Observe the tweet container for the widget-injected iframe and flip `loaded` the
// moment it appears. We don't rely on `window.twttr.widgets.createTweet`'s promise
// for this because in some cases (HMR reloads, certain error paths) the promise
// never resolves even though the widget successfully injects its iframe — leaving
// `loaded` stuck at `false` and the loading placeholder in the DOM, pushing the
// tweet down and inflating the v-drag selection box.
let observer: MutationObserver | null = null

async function create(retries = 10) {
  // @ts-expect-error global
  if (!window.twttr?.widgets?.createTweet) {
    if (retries <= 0)
      return console.error('Failed to load Twitter widget after 10 retries.')
    setTimeout(create, 1000, retries - 1)
    return
  }
  try {
    // @ts-expect-error global
    const element = await window.twttr.widgets.createTweet(
      props.id.toString(),
      tweet.value,
      {
        theme: isDark.value ? 'dark' : 'light',
        conversation: props.conversation || 'none',
        cards: props.cards,
        width: TWEET_NATURAL_W,
      },
    )
    if (element === undefined)
      tweetNotFound.value = true
  }
  finally {
    loaded.value = true
  }
}

let iframeResizeObserver: ResizeObserver | null = null

function watchIframeAR(iframe: HTMLIFrameElement) {
  iframeResizeObserver?.disconnect()
  iframeResizeObserver = new ResizeObserver(() => {
    iframeHeight.value = iframe.offsetHeight
  })
  iframeResizeObserver.observe(iframe)
}

onMounted(() => {
  if (tweet.value) {
    observer = new MutationObserver(() => {
      const iframe = tweet.value?.querySelector('iframe')
      if (iframe) {
        loaded.value = true
        watchIframeAR(iframe)
        observer?.disconnect()
        observer = null
      }
    })
    observer.observe(tweet.value, { childList: true, subtree: true })
  }
  create()
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
  iframeResizeObserver?.disconnect()
  iframeResizeObserver = null
})
</script>

<template>
  <VDrag v-if="props.draggable !== false" :pos="`tweet-${id}`" :lock-aspect-ratio="tweetAR">
    <!-- `data-waitfor="iframe"` signals to `exportSlides` (Playwright build-time
         render — PDF/PNG/OG) to wait for Twitter's widget to inject its iframe
         before screenshotting. Otherwise the screenshot can fire before the
         widget mounts (Twitter's `twttr.widgets.createTweet` resolves async). -->
    <div ref="wrapper" class="tweet-fit" data-waitfor="iframe">
      <!-- DragControl.associatedLink picks this up via `querySelector('a')`,
           surfacing a clickable URL in the control bar when the embed is selected. -->
      <a :href="`https://x.com/i/web/status/${id}`" target="_blank" rel="noopener noreferrer" aria-hidden="true" class="tweet-link" />
      <div ref="tweet" class="tweet slidev-tweet" :style="tweetStyle">
        <div v-if="!loaded || tweetNotFound" class="w-30 h-30 my-10px bg-gray-400 bg-opacity-10 rounded-lg flex opacity-50">
          <div class="m-auto animate-pulse text-4xl">
            <div class="i-carbon:logo-twitter" />
            <span v-if="tweetNotFound">Could not load tweet with id="{{ props.id }}"</span>
          </div>
        </div>
      </div>
    </div>
  </VDrag>
  <Transform v-else :scale="scale || 1">
    <div ref="tweet" class="tweet slidev-tweet" data-waitfor="iframe">
      <div v-if="!loaded || tweetNotFound" class="w-30 h-30 my-10px bg-gray-400 bg-opacity-10 rounded-lg flex opacity-50">
        <div class="m-auto animate-pulse text-4xl">
          <div class="i-carbon:logo-twitter" />
          <span v-if="tweetNotFound">Could not load tweet with id="{{ props.id }}"</span>
        </div>
      </div>
    </div>
  </Transform>
</template>

<style scoped>
.tweet-fit {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.tweet-link {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
</style>

<style>
.slidev-tweet iframe {
  border-radius: 12px;
  overflow: hidden;
}
</style>
