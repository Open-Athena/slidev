// `slidev publish bluesky`: post a built deck as a Bluesky thread, one post per slide, each with
// a link card to the slide (OG image as the thumbnail) and replying to the previous one.
//
// Talks raw XRPC over `fetch` rather than depending on `@atproto/api` (~10 MB unpacked, plus its
// own `zod` major) for the three endpoints it needs.

import type { TextLink, ThreadPost } from './publish'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

export const BLUESKY_MAX_GRAPHEMES = 300
/** `app.bsky.embed.external` thumbs are capped at 1,000,000 bytes. */
export const BLUESKY_MAX_THUMB_BYTES = 1_000_000
export const DEFAULT_BLUESKY_SERVICE = 'https://bsky.social'

export interface BlobRef {
  $type: 'blob'
  ref: { $link: string }
  mimeType: string
  size: number
}

export interface StrongRef {
  uri: string
  cid: string
}

export interface Facet {
  index: { byteStart: number, byteEnd: number }
  features: { $type: 'app.bsky.richtext.facet#link', uri: string }[]
}

export interface PostRecord {
  $type: 'app.bsky.feed.post'
  text: string
  createdAt: string
  facets?: Facet[]
  embed: {
    $type: 'app.bsky.embed.external'
    external: { uri: string, title: string, description: string, thumb?: BlobRef }
  }
  reply?: { root: StrongRef, parent: StrongRef }
}

const encoder = new TextEncoder()

/** Bluesky facets index UTF-8 bytes, not UTF-16 code units. */
export function linkFacets(text: string, links: TextLink[]): Facet[] {
  const byteOffset = (i: number) => encoder.encode(text.slice(0, i)).length
  return links.map(l => ({
    index: { byteStart: byteOffset(l.start), byteEnd: byteOffset(l.end) },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: l.uri }],
  }))
}

export function postRecord(
  post: ThreadPost,
  { createdAt, thumb, reply }: { createdAt: string, thumb?: BlobRef, reply?: PostRecord['reply'] },
): PostRecord {
  const facets = linkFacets(post.text, post.links)
  return {
    $type: 'app.bsky.feed.post',
    text: post.text,
    createdAt,
    ...(facets.length ? { facets } : {}),
    embed: {
      $type: 'app.bsky.embed.external',
      external: { ...post.card, ...(thumb ? { thumb } : {}) },
    },
    ...(reply ? { reply } : {}),
  }
}

/** `https://bsky.app/...` page for an `at://<did>/app.bsky.feed.post/<rkey>` URI. */
export function postWebUrl(handle: string, uri: string): string {
  return `https://bsky.app/profile/${handle}/post/${uri.split('/').pop()}`
}

export interface BlueskyClient {
  did: string
  handle: string
  uploadBlob: (bytes: Uint8Array<ArrayBuffer>, mimeType: string) => Promise<BlobRef>
  createPost: (record: PostRecord) => Promise<StrongRef>
}

async function xrpc<T>(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const res = await fetchImpl(url, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Bluesky ${url.split('/xrpc/')[1]} failed (${res.status}): ${body}`)
  }
  return await res.json() as T
}

/** Log in with an app password; later calls go to the account's own PDS (from its DID doc). */
export async function createBlueskyClient({ service, identifier, password, fetch: fetchImpl = fetch }: {
  service: string
  identifier: string
  password: string
  fetch?: typeof fetch
}): Promise<BlueskyClient> {
  const session = await xrpc<{
    did: string
    handle: string
    accessJwt: string
    didDoc?: { service?: { id: string, serviceEndpoint: string }[] }
  }>(fetchImpl, `${service}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  const pds = session.didDoc?.service?.find(s => s.id === '#atproto_pds')?.serviceEndpoint ?? service
  const auth = { Authorization: `Bearer ${session.accessJwt}` }
  return {
    did: session.did,
    handle: session.handle,
    async uploadBlob(bytes, mimeType) {
      const { blob } = await xrpc<{ blob: BlobRef }>(fetchImpl, `${pds}/xrpc/com.atproto.repo.uploadBlob`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': mimeType },
        body: bytes,
      })
      return blob
    },
    async createPost(record) {
      const { uri, cid } = await xrpc<StrongRef>(fetchImpl, `${pds}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
      })
      return { uri, cid }
    },
  }
}

export interface PostedSlide extends StrongRef {
  no: number
  slug: string
  /** The link card's URL: what identifies a slide's post across re-runs. */
  canonical: string
  url: string
}

/** `_publish/bluesky.json`: the thread so far, so a re-run posts only the slides it's missing. */
export interface BlueskyState {
  version: 1
  did: string
  handle: string
  posts: PostedSlide[]
}

export function statePath(distDir: string): string {
  return resolve(distDir, '_publish', 'bluesky.json')
}

export async function readState(path: string): Promise<BlueskyState | null> {
  if (!existsSync(path))
    return null
  return JSON.parse(await fs.readFile(path, 'utf-8')) as BlueskyState
}

export async function writeState(path: string, state: BlueskyState): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
}

/** Posts not yet in `state`. */
export function pendingPosts(posts: ThreadPost[], state: BlueskyState | null): ThreadPost[] {
  const done = new Set(state?.posts.map(p => p.canonical))
  return posts.filter(p => !done.has(p.card.uri))
}

export interface ThumbImage {
  bytes: Uint8Array<ArrayBuffer>
  mimeType: string
}

export async function readThumb(distDir: string, image: string): Promise<ThumbImage> {
  const bytes = new Uint8Array(await fs.readFile(resolve(distDir, '_og', image)))
  return { bytes, mimeType: extname(image) === '.png' ? 'image/png' : 'image/jpeg' }
}

/**
 * Post each pending slide, replying to the last post in `state` (the thread's root is its first
 * post). `save` runs after every post, so an interrupted run resumes where it stopped.
 */
export async function publishThread({ posts, client, state, readImage, save, now = () => new Date(), log = () => {} }: {
  posts: ThreadPost[]
  client: BlueskyClient
  state: BlueskyState | null
  readImage: (image: string) => Promise<ThumbImage>
  save: (state: BlueskyState) => Promise<void>
  now?: () => Date
  log?: (msg: string) => void
}): Promise<BlueskyState> {
  if (state && state.did !== client.did)
    throw new Error(`This thread was posted by ${state.handle} (${state.did}), not ${client.handle} (${client.did})`)
  const current: BlueskyState = state ?? { version: 1, did: client.did, handle: client.handle, posts: [] }
  for (const post of pendingPosts(posts, current)) {
    const img = await readImage(post.image)
    let thumb: BlobRef | undefined
    if (img.bytes.length > BLUESKY_MAX_THUMB_BYTES)
      log(`slide ${post.no}: ${post.image} is ${img.bytes.length} bytes (limit ${BLUESKY_MAX_THUMB_BYTES}); posting without a thumbnail`)
    else
      thumb = await client.uploadBlob(img.bytes, img.mimeType)
    const root = current.posts[0]
    const parent = current.posts.at(-1)
    const reply = root && parent
      ? { root: { uri: root.uri, cid: root.cid }, parent: { uri: parent.uri, cid: parent.cid } }
      : undefined
    const ref = await client.createPost(postRecord(post, { createdAt: now().toISOString(), thumb, reply }))
    const url = postWebUrl(current.handle, ref.uri)
    current.posts.push({ no: post.no, slug: post.slug, canonical: post.card.uri, ...ref, url })
    await save(current)
    log(`slide ${post.no}: ${url}`)
  }
  return current
}

/** Readable `--dry-run` listing of the thread. */
export function describeThread(posts: ThreadPost[], state: BlueskyState | null): string {
  const pending = new Set(pendingPosts(posts, state))
  return posts.map((p) => {
    const status = pending.has(p) ? '' : ' (already posted)'
    return [
      `${p.no}.${status} ${p.text}`,
      ...p.links.map(l => `   link: ${p.text.slice(l.start, l.end)} → ${l.uri}`),
      `   card: ${p.card.title} → ${p.card.uri}`,
      `   thumb: _og/${p.image}`,
    ].join('\n')
  }).join('\n')
}
