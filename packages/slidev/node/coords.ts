import type { SlidevData } from '@slidev/types'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'

export const COORDS_FILENAME = 'slides.coords.yaml'

const COORDS_HEADER = `# Slidev drag coords — auto-managed by the dev server.
# Tracked in git by default; add to .gitignore if you'd rather keep positions personal.
# Top-level keys are slide numbers (1-based); values are dragId → posStr.
`

export interface CoordsMap {
  // slide number (1-based) -> dragId -> posStr (e.g. "459,35,260,400,0,1000")
  [slideNo: string]: Record<string, string>
}

export function getCoordsFilePath(userRoot: string): string {
  return join(userRoot, COORDS_FILENAME)
}

export async function loadCoords(userRoot: string): Promise<CoordsMap> {
  const filepath = getCoordsFilePath(userRoot)
  if (!existsSync(filepath))
    return {}
  const raw = await readFile(filepath, 'utf-8')
  const parsed = YAML.parse(raw)
  if (!parsed || typeof parsed !== 'object')
    return {}
  // Normalize: numeric keys are stringified, values must be plain dragId->posStr maps
  const out: CoordsMap = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (v && typeof v === 'object' && !Array.isArray(v))
      out[String(k)] = v as Record<string, string>
  }
  return out
}

// Merge coords into in-memory slide frontmatters. coords.yaml wins over inline frontmatter dragPos.
export function applyCoords(data: SlidevData, coords: CoordsMap): void {
  for (let i = 0; i < data.slides.length; i++) {
    const slide = data.slides[i]
    const slideCoords = coords[String(i + 1)]
    if (!slideCoords)
      continue
    slide.frontmatter ??= {}
    slide.frontmatter.dragPos = { ...(slide.frontmatter.dragPos ?? {}), ...slideCoords }
  }
}

// Atomic-ish full-file rewrite (Node's writeFile is atomic per single write call on most FSes).
async function writeCoords(userRoot: string, coords: CoordsMap): Promise<void> {
  const filepath = getCoordsFilePath(userRoot)
  // Write slides in numeric order for stable diffs.
  const ordered: CoordsMap = {}
  const keys = Object.keys(coords)
    .filter(k => Object.keys(coords[k] ?? {}).length > 0)
    .sort((a, b) => Number(a) - Number(b))
  for (const k of keys)
    ordered[k] = coords[k]
  const body = Object.keys(ordered).length === 0 ? '{}\n' : YAML.stringify(ordered)
  await writeFile(filepath, COORDS_HEADER + body, 'utf-8')
}

export async function saveCoordsForSlide(
  userRoot: string,
  slideNo: number,
  dragPos: Record<string, string>,
): Promise<void> {
  const all = await loadCoords(userRoot)
  if (Object.keys(dragPos).length === 0)
    delete all[String(slideNo)]
  else
    all[String(slideNo)] = dragPos
  await writeCoords(userRoot, all)
}
