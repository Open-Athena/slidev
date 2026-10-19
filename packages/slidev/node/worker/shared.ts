// Pure helpers shared by the build (`commands/og.ts`) and the deploy-target Worker
// (`worker/runtime.ts`). Nothing here may import Node built-ins: the Worker bundle is built
// from this file too.

/** A slide URL param, as the Worker canonicalizes it. */
export interface SlideParam {
  /** Every value the slide understands. Anything else is dropped, so cache keys can't be forged. */
  values: string[]
  /** The value the slide shows when the param is absent; dropped from canonical URLs. */
  default: string
}

export type SlideParams = Record<string, SlideParam>

// The query keys slidev itself reads (print / export mode, embeds) plus the card's `v`.
// A slide param with one of these names would collide with them.
export const RESERVED_PARAMS = ['v', 'print', 'range', 'clicks', 'embedded', 'password'] as const

const PARAM_NAME_RE = /^[\w-]+$/

/**
 * Normalize a slide's frontmatter `params` declaration:
 *
 * ```yaml
 * params:
 *   m: { values: [bubbles, heatmap, pm], default: bubbles }
 *   sort: [name, size]      # shorthand; the first value is the default
 * ```
 *
 * Returns the usable params, plus a message for each declaration that was skipped.
 */
export function normalizeSlideParams(raw: unknown): { params: SlideParams, warnings: string[] } {
  const params: SlideParams = {}
  const warnings: string[] = []
  if (raw == null)
    return { params, warnings }
  if (typeof raw !== 'object' || Array.isArray(raw))
    return { params, warnings: ['`params` must be a map of param name to declaration'] }
  for (const [name, decl] of Object.entries(raw as Record<string, unknown>)) {
    if (!PARAM_NAME_RE.test(name)) {
      warnings.push(`param \`${name}\`: names may only contain letters, digits, \`_\` and \`-\``)
      continue
    }
    if ((RESERVED_PARAMS as readonly string[]).includes(name)) {
      warnings.push(`param \`${name}\`: the name is reserved by slidev`)
      continue
    }
    const obj = Array.isArray(decl) ? { values: decl } : decl as { values?: unknown, default?: unknown }
    const values = Array.isArray(obj?.values) ? obj.values.map(v => String(v)) : []
    if (values.length === 0) {
      warnings.push(`param \`${name}\`: needs a non-empty \`values\` list`)
      continue
    }
    const def = obj.default == null ? values[0] : String(obj.default)
    if (!values.includes(def)) {
      warnings.push(`param \`${name}\`: default \`${def}\` isn't one of its \`values\``)
      continue
    }
    params[name] = { values: [...new Set(values)], default: def }
  }
  return { params, warnings }
}

/**
 * The canonical query string (no leading `?`) for a slide's declared params: unknown params and
 * invalid values are dropped, defaults are dropped, and the rest are sorted by name. The default
 * state is `''`. Repeated keys use the first occurrence, as `URLSearchParams.get` does.
 */
export function canonicalizeParams(params: SlideParams | undefined, search: URLSearchParams | string): string {
  if (!params)
    return ''
  const query = typeof search === 'string' ? new URLSearchParams(search) : search
  const out = new URLSearchParams()
  for (const name of Object.keys(params).sort()) {
    const value = query.get(name)
    const decl = params[name]
    if (value != null && value !== decl.default && decl.values.includes(value))
      out.set(name, value)
  }
  return out.toString()
}

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface ShareInfo {
  title: string
  description: string
  /** Absolute URL of the slide page. */
  url: string
  /** Absolute URL of the share card. */
  image: string
}

export interface ShareTag {
  attr: 'name' | 'property'
  key: string
  value: string
  /** Rewritten when the page has it, but never added (non-standard tags). */
  ifPresent?: boolean
}

/** The `<meta>` tags a per-slide page carries (besides `<title>` and `<link rel=canonical>`). */
export function shareTags(info: ShareInfo): ShareTag[] {
  const { title: t, description: d, url: u, image: img } = info
  return [
    { attr: 'name', key: 'description', value: d },
    { attr: 'property', key: 'og:type', value: 'website' },
    { attr: 'property', key: 'og:title', value: t },
    { attr: 'property', key: 'og:description', value: d },
    { attr: 'property', key: 'og:image', value: img },
    { attr: 'property', key: 'og:url', value: u },
    { attr: 'name', key: 'twitter:card', value: 'summary_large_image' },
    { attr: 'name', key: 'twitter:title', value: t },
    { attr: 'name', key: 'twitter:description', value: d },
    { attr: 'name', key: 'twitter:image', value: img },
    { attr: 'name', key: 'twitter:url', value: u, ifPresent: true },
  ]
}

/** `pattern` is an app path (`/foo`) or a prefix glob (`/_og/*`). */
export function matchesPathPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith('*'))
    return path.startsWith(pattern.slice(0, -1))
  return path === pattern
}
