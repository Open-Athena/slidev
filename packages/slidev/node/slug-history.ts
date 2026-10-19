import type { SlidevData } from '@slidev/types'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { slideSlugs } from '@slidev/parser/utils'
import YAML from 'yaml'

// Slides' old slugs, so `/<n>-<old-slug>` links keep leading to their slide after its title (and
// so its slug) changes. The dev server records a change when a reload of the markdown pairs a
// slide with its previous version under another slug (`recordSlugChanges`); the history is applied
// to each slide as frontmatter `slugHistory`, which `slideSlugs` treats as aliases.

export const SLUGS_FILENAME = 'slides.slugs.yaml'

const SLUGS_HEADER = `# Slidev slug history — auto-managed by the dev server.
# Old slugs that still lead to their slide: keys are slides' current slugs, values map each old
# slug to when it stopped being that slide's. When several slides have had a slug, the one that
# had it most recently gets it.
`

/** Current slug → old slug → when (ISO time) the slide stopped having it. */
export type SlugHistory = Record<string, Record<string, string>>

export interface SlugChange {
  from: string
  to: string
}

export async function loadSlugHistory(userRoot: string): Promise<SlugHistory> {
  const filepath = join(userRoot, SLUGS_FILENAME)
  if (!existsSync(filepath))
    return {}
  const parsed = YAML.parse(await readFile(filepath, 'utf-8'))
  const out: SlugHistory = {}
  if (parsed && typeof parsed === 'object') {
    for (const [slug, olds] of Object.entries(parsed)) {
      if (olds && typeof olds === 'object' && !Array.isArray(olds))
        out[slug] = Object.fromEntries(Object.entries(olds).map(([old, at]) => [old, String(at)]))
    }
  }
  return out
}

export async function writeSlugHistory(userRoot: string, history: SlugHistory): Promise<void> {
  const ordered = Object.fromEntries(Object.keys(history).sort().filter(k => Object.keys(history[k]).length).map(k => [k, history[k]]))
  await writeFile(join(userRoot, SLUGS_FILENAME), SLUGS_HEADER + (Object.keys(ordered).length ? YAML.stringify(ordered) : '{}\n'), 'utf-8')
}

/** `history` with each slide's slug change applied: its old slugs follow it, plus the one it left. */
export function recordSlugChanges(history: SlugHistory, changes: SlugChange[], at: string): SlugHistory {
  const next: SlugHistory = Object.fromEntries(Object.entries(history).map(([k, v]) => [k, { ...v }]))
  // Take every moving slide's history first, so swapped slugs don't merge.
  const carried = changes.map(({ from }) => {
    const olds = next[from] ?? {}
    delete next[from]
    return olds
  })
  changes.forEach(({ from, to }, i) => {
    const entry = { ...next[to], ...carried[i], [from]: at }
    delete entry[to]
    next[to] = entry
  })
  return next
}

/**
 * Each current slug's old slugs (newest first). An old slug several slides have had goes to the one
 * that had it most recently, and one that's some slide's current slug goes to none.
 */
export function slugAliases(history: SlugHistory, currentSlugs: string[]): Record<string, string[]> {
  const current = new Set(currentSlugs)
  const holder = new Map<string, { slug: string, at: string }>()
  for (const [slug, olds] of Object.entries(history)) {
    if (!current.has(slug))
      continue
    for (const [old, at] of Object.entries(olds)) {
      if (current.has(old))
        continue
      const prev = holder.get(old)
      if (!prev || at > prev.at)
        holder.set(old, { slug, at })
    }
  }
  const out: Record<string, string[]> = {}
  for (const [old, { slug }] of [...holder].sort((a, b) => b[1].at.localeCompare(a[1].at)))
    (out[slug] ??= []).push(old)
  return out
}

/** A slide's slug, ignoring its slug history (which only adds aliases). */
export function ownSlug(slide: { frontmatter?: Record<string, any>, title?: string }): string {
  return slideSlugs(slide.frontmatter, slide.title).slug
}

/** Set each slide's frontmatter `slugHistory` from `history`. */
export function applySlugHistory(data: SlidevData, history: SlugHistory): void {
  const slugs = data.slides.map(ownSlug)
  const aliases = slugAliases(history, slugs.filter(Boolean))
  data.slides.forEach((slide, i) => {
    slide.frontmatter ??= {}
    const olds = slugs[i] ? aliases[slugs[i]] : undefined
    if (olds?.length)
      slide.frontmatter.slugHistory = olds
    else
      delete slide.frontmatter.slugHistory
  })
}
