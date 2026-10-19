import { describe, expect, it } from 'vitest'
import { defaultPos, parseEmbed } from '../packages/client/composables/embed-insert'
import { blueSkyDragId, isBlueSkyPost } from '../packages/client/logic/bluesky'
import { resolveYoutubeId } from '../packages/client/logic/youtube'

describe('parseEmbed', () => {
  it('turns tweet URLs and ids into `<Tweet id>`', () => {
    expect([
      parseEmbed('tweet', 'https://x.com/slidevjs/status/1390115482657726468?s=20'),
      parseEmbed('tweet', ' 20 '),
      parseEmbed('tweet', 'https://example.com/a/status/20'),
      parseEmbed('tweet', 'abc'),
      parseEmbed('tweet', ''),
    ]).toEqual([
      { snippet: '<Tweet id="1390115482657726468" />', dragId: 'tweet-1390115482657726468' },
      { snippet: '<Tweet id="20" />', dragId: 'tweet-20' },
      null,
      null,
      null,
    ])
  })

  it('turns YouTube URLs and ids into `<Youtube id>`', () => {
    expect([
      parseEmbed('youtube', 'https://www.youtube.com/watch?v=luoMHjh-XcQ&t=10s'),
      parseEmbed('youtube', 'luoMHjh-XcQ'),
      parseEmbed('youtube', 'https://vimeo.com/123'),
    ]).toEqual([
      { snippet: '<Youtube id="luoMHjh-XcQ" />', dragId: 'yt-luoMHjh-XcQ' },
      { snippet: '<Youtube id="luoMHjh-XcQ" />', dragId: 'yt-luoMHjh-XcQ' },
      null,
    ])
  })

  it('turns Bluesky post URLs and at:// URIs into `<BlueSky uri>`', () => {
    expect([
      parseEmbed('bluesky', 'https://bsky.app/profile/sli.dev/post/3lgwg2vy44s2q'),
      parseEmbed('bluesky', 'at://did:plc:432mbsu2xucyvxl6sluohidu/app.bsky.feed.post/3lgwg2vy44s2q'),
      parseEmbed('bluesky', 'https://bsky.app/profile/sli.dev'),
    ]).toEqual([
      { snippet: '<BlueSky uri="https://bsky.app/profile/sli.dev/post/3lgwg2vy44s2q" />', dragId: 'bsky-3lgwg2vy44s2q' },
      { snippet: '<BlueSky uri="at://did:plc:432mbsu2xucyvxl6sluohidu/app.bsky.feed.post/3lgwg2vy44s2q" />', dragId: 'bsky-3lgwg2vy44s2q' },
      null,
    ])
  })
})

describe('resolveYoutubeId', () => {
  it.each([
    'dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  ])('extracts the id from %s', (input) => {
    expect(resolveYoutubeId(input)).toBe('dQw4w9WgXcQ')
  })

  it.each([
    'dQw4w9WgXc',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@channel',
    'https://youtube.com.example.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (input) => {
    expect(resolveYoutubeId(input)).toBeUndefined()
  })
})

describe('bluesky', () => {
  it('recognizes post URLs and at:// post URIs', () => {
    expect([
      'https://bsky.app/profile/sli.dev/post/3lgwg2vy44s2q',
      'at://did:plc:abc/app.bsky.feed.post/3lgwg2vy44s2q',
      'https://bsky.app/profile/sli.dev',
      'at://did:plc:abc/app.bsky.actor.profile/self',
      'sli.dev',
    ].map(isBlueSkyPost)).toEqual([true, true, false, false, false])
  })

  it('derives the dragId from the post segment, else a slug of the uri', () => {
    expect([blueSkyDragId('https://bsky.app/profile/sli.dev/post/3abc'), blueSkyDragId('odd:uri!')]).toEqual(['bsky-3abc', 'bsky-odd-uri'])
  })
})

describe('defaultPos', () => {
  it('centres the element, then cascades 16 px per existing element, wrapping before the edge', () => {
    // 980×552 slide, 480×274 video: centred at (250, 139); 139 / 16 → 9 steps before wrapping.
    expect([0, 1, 2, 8, 9, 10].map(n => defaultPos(480, 274, 980, 552, n))).toEqual([
      '250,139,480,274',
      '266,155,480,274',
      '282,171,480,274',
      '378,267,480,274',
      '250,139,480,274',
      '266,155,480,274',
    ])
    // Bigger than the slide: always at the centre.
    expect([0, 3].map(n => defaultPos(1000, 600, 980, 552, n))).toEqual(['-10,-24,1000,600', '-10,-24,1000,600'])
  })
})
