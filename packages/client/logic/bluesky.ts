// Bluesky post references: `https://bsky.app/profile/<handle>/post/<id>` URLs and
// `at://<did>/app.bsky.feed.post/<id>` URIs. Shared by `BlueSky.vue` and the insert picker.

export const RE_BLUESKY_POST_URL = /^\/profile\/([^/]+)\/post\/([^/?#]+)$/
export const RE_AT_POST_URI = /^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/

export function extractPostInfoFromUrl(input: string): { handle: string, postId: string, postUrl: string } | undefined {
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

/** Whether `input` names a post `BlueSky.vue` can resolve: a post URL or an at:// post URI. */
export function isBlueSkyPost(input: string): boolean {
  return RE_AT_POST_URI.test(input) || !!extractPostInfoFromUrl(input)
}

// Stable dragId derived from the post id (last URL/at-URI segment). Falls back
// to a slugified uri if no recognizable post segment is present.
export function blueSkyDragId(uri: string): string {
  const m = uri.match(/(?:post|app\.bsky\.feed\.post)\/([^/?#]+)/)
  const slug = m?.[1] ?? uri.replace(/\W+/g, '-').replace(/^-+|-+$/g, '').slice(-32)
  return `bsky-${slug}`
}
