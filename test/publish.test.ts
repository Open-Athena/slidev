import type { BlobRef, BlueskyClient, BlueskyState, PostRecord } from '../packages/slidev/node/commands/bluesky'
import type { OgManifest, ThreadPost } from '../packages/slidev/node/commands/publish'
import { describe, expect, it } from 'vitest'
import {
  createBlueskyClient,
  describeThread,
  linkFacets,
  postRecord,
  publishThread,
} from '../packages/slidev/node/commands/bluesky'
import { ogManifest } from '../packages/slidev/node/commands/og'
import { assembleThread, extractLinks, graphemeLength, truncateGraphemes } from '../packages/slidev/node/commands/publish'

const BASE = 'https://slides.example.com'

const manifest: OgManifest = {
  version: 1,
  deck: { title: 'Deck', url: `${BASE}/` },
  slides: [
    { no: 1, slug: 'intro', title: 'Intro', description: 'What this is', canonical: `${BASE}/1-intro`, image: '1-intro.jpg' },
    { no: 2, slug: 'install', title: 'Install', description: 'pnpm i', caption: 'Install it: see [the docs](https://sli.dev/guide) or https://github.com/slidevjs/slidev.', canonical: `${BASE}/2-install`, image: '2-install.jpg' },
    { no: 3, slug: 'aside', title: 'Aside', description: '', canonical: `${BASE}/3-aside`, image: '3-aside.jpg', skipThread: true },
    { no: 4, slug: 'slide-4', title: '', description: 'Only a description', canonical: `${BASE}/4-slide-4`, image: '4-slide-4.png' },
  ],
}

const posts: ThreadPost[] = [
  {
    no: 1,
    slug: 'intro',
    text: 'Intro',
    links: [],
    card: { uri: `${BASE}/1-intro`, title: 'Intro', description: 'What this is' },
    image: '1-intro.jpg',
  },
  {
    no: 2,
    slug: 'install',
    text: 'Install it: see the docs or https://github.com/slidevjs/slidev.',
    links: [
      { start: 16, end: 24, uri: 'https://sli.dev/guide' },
      { start: 28, end: 62, uri: 'https://github.com/slidevjs/slidev' },
    ],
    card: { uri: `${BASE}/2-install`, title: 'Install', description: 'pnpm i' },
    image: '2-install.jpg',
  },
  {
    no: 4,
    slug: 'slide-4',
    text: 'Only a description',
    links: [],
    card: { uri: `${BASE}/4-slide-4`, title: '', description: 'Only a description' },
    image: '4-slide-4.png',
  },
]

describe('extractLinks', () => {
  it('keeps markdown-link text and bare URLs, minus trailing punctuation', () => {
    expect(extractLinks('a [b](https://b.example/x) c https://c.example/y, d')).toEqual({
      text: 'a b c https://c.example/y, d',
      links: [
        { start: 2, end: 3, uri: 'https://b.example/x' },
        { start: 6, end: 25, uri: 'https://c.example/y' },
      ],
    })
  })

  it('leaves text without links alone', () => {
    expect(extractLinks('plain [not a link] (x)')).toEqual({ text: 'plain [not a link] (x)', links: [] })
  })
})

describe('truncateGraphemes', () => {
  it('passes short text through', () => {
    expect(truncateGraphemes('abc', [], 3)).toEqual({ text: 'abc', links: [] })
  })

  it('cuts to max graphemes including the ellipsis, counting emoji clusters as one', () => {
    const family = '👨‍👩‍👧'
    const text = `${family}${family} abc`
    expect(graphemeLength(text)).toBe(6)
    expect(truncateGraphemes(text, [], 3)).toEqual({ text: `${family}${family}…`, links: [] })
  })

  it('clips links at the cut and drops links past it', () => {
    const links = [{ start: 0, end: 5, uri: 'https://a' }, { start: 6, end: 11, uri: 'https://b' }]
    expect(truncateGraphemes('hello world', links, 4)).toEqual({
      text: 'hel…',
      links: [{ start: 0, end: 3, uri: 'https://a' }],
    })
  })
})

describe('assembleThread', () => {
  it('builds one post per slide: caption, else title, else description; skipThread omitted', () => {
    expect(assembleThread(manifest, { maxGraphemes: 300 })).toEqual(posts)
  })

  it('truncates to the grapheme limit', () => {
    const long: OgManifest = { ...manifest, slides: [{ ...manifest.slides[0], caption: 'x'.repeat(400) }] }
    expect(assembleThread(long, { maxGraphemes: 300 }).map(p => p.text)).toEqual([`${'x'.repeat(299)}…`])
  })
})

describe('ogManifest', () => {
  it('maps OG plans to manifest slides', () => {
    const plan = {
      no: 2,
      slug: 'install',
      aliases: [],
      title: 'Install',
      description: 'pnpm i',
      canonical: `${BASE}/2-install`,
      imageUrl: `${BASE}/_og/2-install.jpg`,
      overrideSrc: null,
      imageFilename: '2-install.jpg',
      htmlFilename: '2-install.html',
      contentHash: '0123456789ab',
      appPath: '/2-install',
      imageAppPath: '/_og/2-install.jpg',
      params: {},
    }
    expect(ogManifest(
      [plan, { ...plan, no: 3, caption: 'Hi', skipThread: true }],
      { title: 'Deck', url: `${BASE}/`, bluesky: { handle: 'deck.bsky.social' } },
    )).toEqual({
      version: 1,
      deck: { title: 'Deck', url: `${BASE}/`, bluesky: { handle: 'deck.bsky.social' } },
      slides: [
        { no: 2, slug: 'install', title: 'Install', description: 'pnpm i', canonical: `${BASE}/2-install`, image: '2-install.jpg' },
        { no: 3, slug: 'install', title: 'Install', description: 'pnpm i', caption: 'Hi', canonical: `${BASE}/2-install`, image: '2-install.jpg', skipThread: true },
      ],
    })
  })
})

describe('linkFacets', () => {
  it('indexes UTF-8 bytes', () => {
    // "é" is 1 UTF-16 unit but 2 UTF-8 bytes; "🎉" is 2 units, 4 bytes.
    const text = 'é🎉 link'
    expect(linkFacets(text, [{ start: 4, end: 8, uri: 'https://x' }])).toEqual([
      { index: { byteStart: 7, byteEnd: 11 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x' }] },
    ])
  })
})

const thumb = (n: number): BlobRef => ({ $type: 'blob', ref: { $link: `bafkthumb${n}` }, mimeType: 'image/jpeg', size: 100 + n })

describe('postRecord', () => {
  it('builds a reply with facets and a thumb', () => {
    const root = { uri: 'at://did:plc:me/app.bsky.feed.post/r', cid: 'bafyr' }
    const parent = { uri: 'at://did:plc:me/app.bsky.feed.post/p', cid: 'bafyp' }
    expect(postRecord(posts[1], { createdAt: '2026-10-18T00:00:00.000Z', thumb: thumb(2), reply: { root, parent } })).toEqual({
      $type: 'app.bsky.feed.post',
      text: 'Install it: see the docs or https://github.com/slidevjs/slidev.',
      createdAt: '2026-10-18T00:00:00.000Z',
      facets: [
        { index: { byteStart: 16, byteEnd: 24 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://sli.dev/guide' }] },
        { index: { byteStart: 28, byteEnd: 62 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://github.com/slidevjs/slidev' }] },
      ],
      embed: {
        $type: 'app.bsky.embed.external',
        external: { uri: `${BASE}/2-install`, title: 'Install', description: 'pnpm i', thumb: thumb(2) },
      },
      reply: { root, parent },
    })
  })

  it('omits facets, thumb and reply when absent', () => {
    expect(postRecord(posts[0], { createdAt: '2026-10-18T00:00:00.000Z' })).toEqual({
      $type: 'app.bsky.feed.post',
      text: 'Intro',
      createdAt: '2026-10-18T00:00:00.000Z',
      embed: {
        $type: 'app.bsky.embed.external',
        external: { uri: `${BASE}/1-intro`, title: 'Intro', description: 'What this is' },
      },
    })
  })
})

function fakeClient(did = 'did:plc:me') {
  const calls: ({ upload: [number, string] } | { post: PostRecord })[] = []
  let blobs = 0
  let rkeys = 0
  const client: BlueskyClient = {
    did,
    handle: 'me.bsky.social',
    async uploadBlob(bytes, mimeType) {
      calls.push({ upload: [bytes.length, mimeType] })
      return thumb(++blobs)
    },
    async createPost(record) {
      calls.push({ post: record })
      rkeys++
      return { uri: `at://${did}/app.bsky.feed.post/rk${rkeys}`, cid: `bafy${rkeys}` }
    },
  }
  return { client, calls }
}

const T = '2026-10-18T12:00:00.000Z'
async function readImage(image: string) {
  return {
    bytes: new Uint8Array(image.startsWith('4-') ? 1_000_001 : 10),
    mimeType: image.endsWith('.png') ? 'image/png' : 'image/jpeg',
  }
}

describe('publishThread', () => {
  const posted = (n: number, post: ThreadPost) => ({
    no: post.no,
    slug: post.slug,
    canonical: post.card.uri,
    uri: `at://did:plc:me/app.bsky.feed.post/rk${n}`,
    cid: `bafy${n}`,
    url: `https://bsky.app/profile/me.bsky.social/post/rk${n}`,
  })
  const ref = (n: number) => ({ uri: `at://did:plc:me/app.bsky.feed.post/rk${n}`, cid: `bafy${n}` })

  it('posts a reply chain, saving state after each post; oversized thumbs are skipped', async () => {
    const { client, calls } = fakeClient()
    const saves: number[] = []
    const logs: string[] = []
    const state = await publishThread({
      posts,
      client,
      state: null,
      readImage,
      save: async s => void saves.push(s.posts.length),
      now: () => new Date(T),
      log: msg => logs.push(msg),
    })
    expect(calls).toEqual([
      { upload: [10, 'image/jpeg'] },
      { post: postRecord(posts[0], { createdAt: T, thumb: thumb(1) }) },
      { upload: [10, 'image/jpeg'] },
      { post: postRecord(posts[1], { createdAt: T, thumb: thumb(2), reply: { root: ref(1), parent: ref(1) } }) },
      { post: postRecord(posts[2], { createdAt: T, reply: { root: ref(1), parent: ref(2) } }) },
    ])
    expect(state).toEqual({
      version: 1,
      did: 'did:plc:me',
      handle: 'me.bsky.social',
      posts: [posted(1, posts[0]), posted(2, posts[1]), posted(3, posts[2])],
    })
    expect(saves).toEqual([1, 2, 3])
    expect(logs).toEqual([
      'slide 1: https://bsky.app/profile/me.bsky.social/post/rk1',
      'slide 2: https://bsky.app/profile/me.bsky.social/post/rk2',
      'slide 4: 4-slide-4.png is 1000001 bytes (limit 1000000); posting without a thumbnail',
      'slide 4: https://bsky.app/profile/me.bsky.social/post/rk3',
    ])
  })

  it('resumes after the posts already in state', async () => {
    const { client, calls } = fakeClient()
    // The fake's rkeys restart at 1, so the resumed post is `rk1`; the existing ones keep theirs.
    const prior: BlueskyState = {
      version: 1,
      did: 'did:plc:me',
      handle: 'me.bsky.social',
      posts: [
        { ...posted(1, posts[0]), uri: 'at://did:plc:me/app.bsky.feed.post/a', cid: 'bafya', url: 'https://bsky.app/profile/me.bsky.social/post/a' },
        { ...posted(2, posts[1]), uri: 'at://did:plc:me/app.bsky.feed.post/b', cid: 'bafyb', url: 'https://bsky.app/profile/me.bsky.social/post/b' },
      ],
    }
    const state = await publishThread({
      posts: posts.slice(0, 2).concat({ ...posts[2], image: '5.jpg' }),
      client,
      state: structuredClone(prior),
      readImage,
      save: async () => {},
      now: () => new Date(T),
    })
    expect(calls).toEqual([
      { upload: [10, 'image/jpeg'] },
      {
        post: postRecord({ ...posts[2], image: '5.jpg' }, {
          createdAt: T,
          thumb: thumb(1),
          reply: {
            root: { uri: 'at://did:plc:me/app.bsky.feed.post/a', cid: 'bafya' },
            parent: { uri: 'at://did:plc:me/app.bsky.feed.post/b', cid: 'bafyb' },
          },
        }),
      },
    ])
    expect(state.posts).toEqual([...prior.posts, posted(1, posts[2])])
  })

  it('refuses to continue another account\'s thread', async () => {
    const { client, calls } = fakeClient('did:plc:other')
    const prior: BlueskyState = { version: 1, did: 'did:plc:me', handle: 'me.bsky.social', posts: [] }
    await expect(publishThread({ posts, client, state: prior, readImage, save: async () => {} }))
      .rejects
      .toThrow('This thread was posted by me.bsky.social (did:plc:me), not me.bsky.social (did:plc:other)')
    expect(calls).toEqual([])
  })
})

describe('createBlueskyClient', () => {
  it('logs in, then uploads and posts to the PDS from the DID doc', async () => {
    const requests: { url: string, method?: string, headers?: unknown, body: unknown }[] = []
    const responses = [
      {
        did: 'did:plc:me',
        handle: 'me.bsky.social',
        accessJwt: 'jwt',
        didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] },
      },
      { blob: thumb(1) },
      { uri: 'at://did:plc:me/app.bsky.feed.post/rk1', cid: 'bafy1', commit: {} },
    ]
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body instanceof Uint8Array ? Array.from(init.body) : JSON.parse(String(init.body)),
      })
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }) as typeof fetch

    const client = await createBlueskyClient({ service: 'https://bsky.social', identifier: 'me.bsky.social', password: 'app-pw', fetch: fetchImpl })
    expect([client.did, client.handle]).toEqual(['did:plc:me', 'me.bsky.social'])
    expect(await client.uploadBlob(new Uint8Array([1, 2]), 'image/jpeg')).toEqual(thumb(1))
    const record = postRecord(posts[0], { createdAt: T })
    expect(await client.createPost(record)).toEqual({ uri: 'at://did:plc:me/app.bsky.feed.post/rk1', cid: 'bafy1' })

    expect(requests).toEqual([
      {
        url: 'https://bsky.social/xrpc/com.atproto.server.createSession',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { identifier: 'me.bsky.social', password: 'app-pw' },
      },
      {
        url: 'https://pds.example/xrpc/com.atproto.repo.uploadBlob',
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt', 'Content-Type': 'image/jpeg' },
        body: [1, 2],
      },
      {
        url: 'https://pds.example/xrpc/com.atproto.repo.createRecord',
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt', 'Content-Type': 'application/json' },
        body: { repo: 'did:plc:me', collection: 'app.bsky.feed.post', record },
      },
    ])
  })

  it('throws on XRPC errors', async () => {
    const fetchImpl = (async () => new Response('{"error":"AuthenticationRequired"}', { status: 401 })) as unknown as typeof fetch
    await expect(createBlueskyClient({ service: 'https://bsky.social', identifier: 'me', password: 'x', fetch: fetchImpl }))
      .rejects
      .toThrow('Bluesky com.atproto.server.createSession failed (401): {"error":"AuthenticationRequired"}')
  })
})

describe('describeThread', () => {
  it('lists each post, its links, card and thumb, marking posted ones', () => {
    const state: BlueskyState = {
      version: 1,
      did: 'did:plc:me',
      handle: 'me.bsky.social',
      posts: [{ no: 1, slug: 'intro', canonical: `${BASE}/1-intro`, uri: 'at://x/app.bsky.feed.post/a', cid: 'c', url: 'https://bsky.app/profile/me.bsky.social/post/a' }],
    }
    expect(describeThread(posts, state).split('\n')).toEqual([
      '1. (already posted) Intro',
      `   card: Intro → ${BASE}/1-intro`,
      '   thumb: _og/1-intro.jpg',
      '2. Install it: see the docs or https://github.com/slidevjs/slidev.',
      '   link: the docs → https://sli.dev/guide',
      '   link: https://github.com/slidevjs/slidev → https://github.com/slidevjs/slidev',
      `   card: Install → ${BASE}/2-install`,
      '   thumb: _og/2-install.jpg',
      '4. Only a description',
      `   card:  → ${BASE}/4-slide-4`,
      '   thumb: _og/4-slide-4.png',
    ])
  })
})
