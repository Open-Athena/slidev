// Network-free half of `slidev publish`: read the build's `_og/slides.json` manifest and assemble
// one platform-neutral post per slide. Platform modules (`./bluesky`) turn these into their own
// records and do the posting.

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { resolve } from 'node:path'

export interface OgManifestSlide {
  no: number
  slug: string
  /** OG title (frontmatter `title`, else the first heading, else `<deck> — Slide <n>`). */
  title: string
  /** OG description (frontmatter `description`, else the first paragraph, else the deck's). */
  description: string
  /** Frontmatter `caption`. */
  caption?: string
  /** Absolute URL of the slide in the interactive deck. */
  canonical: string
  /** OG image filename, under `_og/`. */
  image: string
  skipThread?: boolean
}

export interface OgManifest {
  version: 1
  deck: {
    title: string
    /** Absolute URL of the deck. */
    url: string
    bluesky?: { handle: string }
  }
  slides: OgManifestSlide[]
}

/** A link in a post's text, as UTF-16 (JS string) offsets; `end` is exclusive. */
export interface TextLink {
  start: number
  end: number
  uri: string
}

/** One slide's post, independent of the platform it goes to. */
export interface ThreadPost {
  no: number
  slug: string
  text: string
  links: TextLink[]
  /** Link card: the slide's canonical URL and OG text. */
  card: { uri: string, title: string, description: string }
  /** OG image filename, under `_og/`. */
  image: string
}

export interface AssembleOptions {
  /** Post-length limit, in graphemes (Bluesky: 300). */
  maxGraphemes: number
}

const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const URL_RE = /https?:\/\/[^\s<>"]+/g
// Sentence punctuation right after a bare URL ("see https://x.y.") isn't part of it.
const URL_TRAILING_PUNCT_RE = /[.,;:!?'")\]]+$/

/**
 * Plain text plus link spans: `[text](url)` keeps `text`, linked to `url`; bare `http(s)://` URLs
 * stay as written and link to themselves.
 */
export function extractLinks(source: string): { text: string, links: TextLink[] } {
  let text = ''
  const links: TextLink[] = []
  let last = 0
  for (const m of source.matchAll(MD_LINK_RE)) {
    pushBare(source.slice(last, m.index))
    links.push({ start: text.length, end: text.length + m[1].length, uri: m[2] })
    text += m[1]
    last = m.index + m[0].length
  }
  pushBare(source.slice(last))
  return { text, links }

  function pushBare(chunk: string) {
    for (const m of chunk.matchAll(URL_RE)) {
      const uri = m[0].replace(URL_TRAILING_PUNCT_RE, '')
      const start = text.length + m.index
      links.push({ start, end: start + uri.length, uri })
    }
    text += chunk
  }
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function graphemeLength(s: string): number {
  let n = 0
  for (const _ of segmenter.segment(s))
    n++
  return n
}

/**
 * Cut `text` to at most `max` graphemes, ending with `…` when cut. Links are clipped to the
 * kept text (dropped when nothing of them is left).
 */
export function truncateGraphemes(text: string, links: TextLink[], max: number): { text: string, links: TextLink[] } {
  if (graphemeLength(text) <= max)
    return { text, links }
  let cut = 0
  let n = 0
  for (const { index } of segmenter.segment(text)) {
    if (n === max - 1) {
      cut = index
      break
    }
    n++
  }
  const kept = text.slice(0, cut).trimEnd()
  return {
    text: `${kept}…`,
    links: links
      .filter(l => l.start < kept.length)
      .map(l => ({ ...l, end: Math.min(l.end, kept.length) })),
  }
}

/** Post text source: frontmatter `caption`, else the slide title, else its description. */
export function postSource(slide: OgManifestSlide): string {
  return slide.caption?.trim() || slide.title.trim() || slide.description.trim()
}

/** One post per slide, in deck order, minus `skipThread` slides. */
export function assembleThread(manifest: OgManifest, { maxGraphemes }: AssembleOptions): ThreadPost[] {
  return manifest.slides
    .filter(s => !s.skipThread)
    .map((s) => {
      const extracted = extractLinks(postSource(s))
      const { text, links } = truncateGraphemes(extracted.text, extracted.links, maxGraphemes)
      return {
        no: s.no,
        slug: s.slug,
        text,
        links,
        card: { uri: s.canonical, title: s.title, description: s.description },
        image: s.image,
      }
    })
}

export function manifestPath(distDir: string): string {
  return resolve(distDir, '_og', 'slides.json')
}

export async function readManifest(distDir: string): Promise<OgManifest> {
  const path = manifestPath(distDir)
  if (!existsSync(path))
    throw new Error(`No ${path}; run \`slidev build\` with \`publish.baseUrl\` set in the headmatter first`)
  const manifest = JSON.parse(await fs.readFile(path, 'utf-8')) as OgManifest
  if (manifest.version !== 1)
    throw new Error(`Unsupported ${path} version: ${manifest.version}`)
  return manifest
}
