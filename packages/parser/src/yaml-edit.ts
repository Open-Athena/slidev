// Formatting-preserving YAML edits (the approach of github.com/Open-Athena/yaya, in TypeScript):
// parse with source ranges, then splice only the changed value's text into the original, so
// comments, spacing, quoting, flow vs. block style and long lines elsewhere stay byte for byte.
// Added keys copy their siblings' indentation (and flow style). Tested in `test/yaml-edit.test.ts`.

import YAML from 'yaml'

type Path = (string | number)[]

// Serialize a value for insertion, without folding long lines.
function serialize(value: unknown, opts: YAML.ToStringOptions = {}): string {
  return YAML.stringify(value, { lineWidth: 0, flowCollectionPadding: false, ...opts }).replace(/\n$/, '')
}

function lineStart(src: string, offset: number): number {
  return src.lastIndexOf('\n', offset - 1) + 1
}

function lineEnd(src: string, offset: number): number {
  const i = src.indexOf('\n', offset)
  return i < 0 ? src.length : i
}

function column(src: string, offset: number): number {
  return offset - lineStart(src, offset)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// The text for `value` replacing `node` (or placed after `key:` at `indent`), in a matching style.
function valueText(value: unknown, node: YAML.Node | null | undefined, indent: number): { text: string, block: boolean } {
  if (YAML.isScalar(node) && !isPlainObject(value) && !Array.isArray(value)) {
    const quoted = node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE'
    return { text: serialize(value, quoted && typeof value === 'string' ? { defaultStringType: node.type as any } : {}), block: false }
  }
  const flow = YAML.isCollection(node) ? !!node.flow : false
  if (flow || (!isPlainObject(value) && !Array.isArray(value)) || (Array.isArray(value) && !value.length) || (isPlainObject(value) && !Object.keys(value).length))
    return { text: serialize(value, flow ? { collectionStyle: 'flow' } : {}), block: false }
  // Block collection: one item per line, indented under the key.
  const lines = serialize(value).split('\n')
  return { text: lines.map(l => ' '.repeat(indent) + l).join('\n'), block: true }
}

/** Set `path` to `value`, adding it (after its siblings) if absent. Returns the new YAML text. */
export function setYamlIn(src: string, path: Path, value: unknown): string {
  if (!path.length)
    return serialize(value)
  const doc = YAML.parseDocument(src)
  const node = doc.getIn(path, true) as YAML.Node | undefined
  if (node && node.range) {
    const [start, valueEnd] = node.range
    const keyPair = parentPair(doc, path)
    const keyCol = keyPair ? column(src, (keyPair.key as YAML.Node).range![0]) : 0
    if (YAML.isCollection(node) && !node.flow && (isPlainObject(value) || Array.isArray(value))) {
      // Replace a block collection's lines with the new block, at the same indentation.
      const from = lineStart(src, start)
      const to = lineEnd(src, valueEnd - 1)
      const { text } = valueText(value, node, column(src, start))
      return src.slice(0, from) + text + src.slice(to)
    }
    const { text, block } = valueText(value, node, keyCol + 2)
    return block
      ? `${src.slice(0, start).replace(/[ \t]*$/, '')}\n${text}${src.slice(valueEnd)}`
      : src.slice(0, start) + text + src.slice(valueEnd)
  }
  // Absent: add it to the nearest existing ancestor map.
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  const parent = (parentPath.length ? doc.getIn(parentPath, true) : doc.contents) as YAML.Node | null | undefined
  if (!YAML.isMap(parent)) {
    if (!parentPath.length && (parent == null || (YAML.isScalar(parent) && parent.value == null)))
      return serialize({ [key]: value })
    return setYamlIn(src, parentPath, { [key]: value })
  }
  if (parent.flow) {
    const close = src.lastIndexOf('}', parent.range![1])
    const sep = parent.items.length ? ', ' : ''
    return `${src.slice(0, close)}${sep}${key}: ${serialize(value, { collectionStyle: 'flow' })}${src.slice(close)}`
  }
  const first = parent.items[0]
  const indent = first ? column(src, (first.key as YAML.Node).range![0]) : 0
  const last = parent.items[parent.items.length - 1]
  const lastEnd = last ? lineEnd(src, ((last.value as YAML.Node | null)?.range?.[1] ?? (last.key as YAML.Node).range![1]) - 1) : src.length
  const { text, block } = valueText(value, null, indent + 2)
  const line = `${' '.repeat(indent)}${key}:${block ? `\n${text}` : ` ${text}`}`
  return src.slice(0, lastEnd) + (src.slice(0, lastEnd).endsWith('\n') || !lastEnd ? '' : '\n') + line + src.slice(lastEnd)
}

function parentPair(doc: YAML.Document, path: Path): YAML.Pair | undefined {
  const parent = (path.length > 1 ? doc.getIn(path.slice(0, -1), true) : doc.contents) as YAML.Node | null
  return YAML.isMap(parent) ? parent.items.find(p => YAML.isScalar(p.key) && p.key.value === path[path.length - 1]) : undefined
}

/** Remove `path` (its key and value lines). Returns the new YAML text. */
export function deleteYamlIn(src: string, path: Path): string {
  const doc = YAML.parseDocument(src)
  const parent = (path.length > 1 ? doc.getIn(path.slice(0, -1), true) : doc.contents) as YAML.Node | null
  if (!YAML.isMap(parent))
    return src
  const index = parent.items.findIndex(p => YAML.isScalar(p.key) && p.key.value === path[path.length - 1])
  if (index < 0)
    return src
  const pair = parent.items[index]
  const keyStart = (pair.key as YAML.Node).range![0]
  const valueEnd = (pair.value as YAML.Node | null)?.range?.[1] ?? (pair.key as YAML.Node).range![1]
  if (parent.flow) {
    const next = parent.items[index + 1]
    const end = next ? (next.key as YAML.Node).range![0] : valueEnd
    const start = next ? keyStart : src.lastIndexOf(',', keyStart) >= parent.range![0] ? src.lastIndexOf(',', keyStart) : keyStart
    return src.slice(0, start) + src.slice(end)
  }
  const from = lineStart(src, keyStart)
  const to = lineEnd(src, valueEnd - 1)
  // The last lines: take the newline before them, not a (missing) one after.
  if (to >= src.length)
    return src.slice(0, Math.max(0, from - 1))
  return src.slice(0, from) + src.slice(to + 1)
}

/**
 * Apply a patch: each key of `patch` is set (objects onto existing maps key by key, so keys the
 * patch leaves alone keep their text), `null` deletes, and unchanged values aren't touched.
 */
export function patchYaml(src: string, patch: Record<string, unknown>, path: Path = []): string {
  for (const [key, value] of Object.entries(patch)) {
    const at = [...path, key]
    const doc = YAML.parseDocument(src)
    const node = doc.getIn(at, true) as YAML.Node | undefined
    if (value == null) {
      src = deleteYamlIn(src, at)
      continue
    }
    if (isPlainObject(value) && YAML.isMap(node)) {
      src = patchYaml(src, value, at)
      for (const item of node.items) {
        const k = YAML.isScalar(item.key) ? item.key.value : item.key
        if (typeof k === 'string' && !(k in value))
          src = deleteYamlIn(src, [...at, k])
      }
      continue
    }
    const current = YAML.isNode(node) ? node.toJSON() : node
    if (JSON.stringify(current) !== JSON.stringify(value))
      src = setYamlIn(src, at, value)
  }
  return src
}
