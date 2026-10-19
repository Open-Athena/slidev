const YOUTUBE_HOSTS = new Set([
  'm.youtube.com',
  'music.youtube.com',
  'www.youtube-nocookie.com',
  'www.youtube.com',
  'youtube-nocookie.com',
  'youtube.com',
])

const RE_VIDEO_ID = /^[\w-]{11}$/

/**
 * The video id in a bare id or a YouTube URL (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`,
 * `/live/`), as `<Youtube id>` takes it; `undefined` if there's none.
 */
export function resolveYoutubeId(input: string): string | undefined {
  const s = input.trim()
  if (RE_VIDEO_ID.test(s))
    return s
  try {
    const url = new URL(s)
    if (!['http:', 'https:'].includes(url.protocol))
      return
    let id: string | null | undefined
    if (url.hostname === 'youtu.be') {
      id = url.pathname.split('/')[1]
    }
    else if (YOUTUBE_HOSTS.has(url.hostname)) {
      const [first, second] = url.pathname.split('/').filter(Boolean)
      id = first === 'watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(first) ? second : undefined
    }
    return id && RE_VIDEO_ID.test(id) ? id : undefined
  }
  catch {}
}
