// Pure helpers for the insert picker's embed tabs (`InsertImageDialog.vue`): parse a pasted URL
// or id into the component's markup and the dragId it will get, and pick a default position.
// Tested in `test/embed-insert.test.ts`.

import { blueSkyDragId, isBlueSkyPost } from '../logic/bluesky'
import { resolveTweetId } from '../logic/tweet'
import { resolveYoutubeId } from '../logic/youtube'

export type EmbedKind = 'tweet' | 'youtube' | 'bluesky'

export interface Embed {
  /** The component's markup, e.g. `<Tweet id="20" />`. */
  snippet: string
  /** The id its `VDrag` wrapper uses (`tweet-<id>`, `yt-<id>`, `bsky-<post>`). */
  dragId: string
}

/**
 * The embed for `input` (a URL, or an id where the component takes one), or `null` if it isn't
 * one. Tweets and videos are inserted by id (`<Tweet url>` would leave its dragId `tweet-undefined`).
 */
export function parseEmbed(kind: EmbedKind, input: string): Embed | null {
  const s = input.trim()
  if (!s)
    return null
  if (kind === 'tweet') {
    const id = /^\d+$/.test(s) ? s : resolveTweetId(undefined, s)
    return id ? { snippet: `<Tweet id="${id}" />`, dragId: `tweet-${id}` } : null
  }
  if (kind === 'youtube') {
    const id = resolveYoutubeId(s)
    return id ? { snippet: `<Youtube id="${id}" />`, dragId: `yt-${id}` } : null
  }
  if (!isBlueSkyPost(s))
    return null
  const uri = s.replace(/"/g, '%22')
  return { snippet: `<BlueSky uri="${uri}" />`, dragId: blueSkyDragId(uri) }
}

/**
 * Initial `[width, height]` per embed, in slide px (including `VDrag`'s 4 px padding). Tweets'
 * and posts' heights are placeholders: their wrappers lock the height to the loaded content's AR.
 */
export const EMBED_SIZE: Record<EmbedKind, [number, number]> = {
  tweet: [400, 300],
  youtube: [480, 274],
  bluesky: [400, 200],
}

const CASCADE = 16

/**
 * A position string (`Left,Top,Width,Height`) for a new `w`×`h` element on a `slideW`×`slideH`
 * slide that already has `existing` elements: centred, then 16 px down-right per existing
 * element so repeated inserts don't stack exactly, wrapping back to the centre before running
 * off the slide.
 */
export function defaultPos(w: number, h: number, slideW: number, slideH: number, existing: number): string {
  const left = (slideW - w) / 2
  const top = (slideH - h) / 2
  const steps = Math.max(1, Math.floor(Math.min(left, top) / CASCADE) + 1)
  const shift = (existing % steps) * CASCADE
  return [left + shift, top + shift, w, h].map(Math.round).join()
}
