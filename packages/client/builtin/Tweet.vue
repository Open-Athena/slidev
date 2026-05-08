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
// via postMessage). Track that height so the v-drag wrapper's AR can lock to the
// content's natural AR (= 550 / iframeHeight) — no empty gap below or clipped overflow.
const tweetAR = ref<number | null>(null)

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
    const h = iframe.offsetHeight
    if (h > 0)
      tweetAR.value = TWEET_NATURAL_W / h
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
  <VDrag v-if="props.draggable !== false" :pos="`tweet-${id}`" :lock-aspect-ratio="tweetAR ?? undefined">
    <div ref="wrapper" class="tweet-fit">
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
    <div ref="tweet" class="tweet slidev-tweet">
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
</style>

<style>
.slidev-tweet iframe {
  border-radius: 12px;
  overflow: hidden;
}
</style>
