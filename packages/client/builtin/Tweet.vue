<!--
A simple wrapper for embedded Tweet

Usage:

<Tweet id="20" />
-->

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
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

const tweet = ref<HTMLElement | null>()

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
    setTimeout(() => create(retries - 1), 1000)
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
      },
    )
    if (element === undefined)
      tweetNotFound.value = true
  }
  finally {
    loaded.value = true
  }
}

onMounted(() => {
  if (tweet.value) {
    observer = new MutationObserver(() => {
      if (tweet.value?.querySelector('iframe')) {
        loaded.value = true
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
})
</script>

<template>
  <VDrag v-if="props.draggable !== false" :pos="`tweet-${id}`">
    <Transform :scale="scale || 1" class="h-full">
      <div ref="tweet" class="tweet slidev-tweet">
        <div v-if="!loaded || tweetNotFound" class="w-30 h-30 my-10px bg-gray-400 bg-opacity-10 rounded-lg flex opacity-50">
          <div class="m-auto animate-pulse text-4xl">
            <div class="i-carbon:logo-twitter" />
            <span v-if="tweetNotFound">Could not load tweet with id="{{ props.id }}"</span>
          </div>
        </div>
      </div>
    </Transform>
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

<style>
.slidev-tweet iframe {
  border-radius: 12px;
  overflow: hidden;
}
</style>
