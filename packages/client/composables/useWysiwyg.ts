import type { Editor } from '@milkdown/kit/core'
import type { LineRange } from './text-edit'
import { changedRange } from './list-edit'
import { parseLineRange } from './text-edit'
import { pushTextEdit } from './useDragHistory'
import { linesCorrespond, mergeEdited } from './wysiwyg-merge'

// WYSIWYG block editing (prototype, dev only, headmatter `wysiwyg: true`): double-clicking a run
// of plain-markdown blocks (paragraphs, headings, lists, blockquotes, tables) opens a Milkdown
// (ProseMirror + remark) editor in their place. Fidelity: the editor only opens when its
// serialization of the unedited region lines up with the source line for line, and a save keeps
// every line the user didn't change byte for byte (`wysiwyg-merge.ts`), so the serializer's
// normalizations (escapes, table padding, …) can't rewrite text nobody touched. Otherwise the
// caller falls back to per-block editing. ⌘Enter or clicking
// away saves, Esc cancels; one `text` history event per session.

/** Mirrors `SOURCE_BLOCK_ATTR` in `node/syntax/source-lines.ts`. */
export const BLOCK_ATTR = 'data-slidev-block'

interface Region {
  blocks: HTMLElement[]
  slideNo: number
  range: LineRange
}

let active: { finish: (commit: boolean) => Promise<void> } | null = null

export function isWysiwygEditing(): boolean {
  return active !== null
}

/** The run of adjacent top-level blocks around `el`, contiguous in the source (blank lines between). */
function regionAt(el: HTMLElement, lines: string[], slideNo: number): Region | null {
  const block = el.closest<HTMLElement>(`[${BLOCK_ATTR}]`)
  if (!block || !block.closest('#slide-content'))
    return null
  const rangeOf = (b: Element) => {
    const r = parseLineRange(b.getAttribute(BLOCK_ATTR))
    if (!r)
      return null
    // markdown-it's list / blockquote ranges include the trailing blank line.
    let [start, end] = r
    while (end > start + 1 && lines[end - 1]?.trim() === '')
      end--
    return [start, end] as LineRange
  }
  const blankBetween = (a: LineRange, b: LineRange) => a[1] <= b[0] && lines.slice(a[1], b[0]).every(l => l.trim() === '')
  const first = rangeOf(block)
  if (!first)
    return null
  const blocks = [block]
  let range = first
  for (let p = block.previousElementSibling; p?.hasAttribute(BLOCK_ATTR); p = p.previousElementSibling) {
    const r = rangeOf(p)
    if (!r || !blankBetween(r, range))
      break
    blocks.unshift(p as HTMLElement)
    range = [r[0], range[1]]
  }
  for (let n = block.nextElementSibling; n?.hasAttribute(BLOCK_ATTR); n = n.nextElementSibling) {
    const r = rangeOf(n)
    if (!r || !blankBetween(range, r))
      break
    blocks.push(n as HTMLElement)
    range = [range[0], r[1]]
  }
  return { blocks, slideNo, range }
}

// Serializer options matching the source's own style, so an unedited region round-trips.
function stringifyOptions(md: string) {
  return {
    bullet: (/^[ \t>]*\*[ \t]/m.test(md) && !/^[ \t>]*-[ \t]/m.test(md) ? '*' : '-') as '*' | '-',
    emphasis: (/(?:^|[^*\w])_[^_\s]/.test(md) && !/(?:^|[^*])\*[^*\s]/.test(md) ? '_' : '*') as '_' | '*',
    strong: (/__[^_\s]/.test(md) ? '_' : '*') as '_' | '*',
    listItemIndent: 'one' as const,
    rule: '-' as const,
    fences: true,
    incrementListMarker: !/^[ \t]*1\.[ \t].*\n[ \t]*1\.[ \t]/m.test(md),
  }
}

async function createEditor(root: HTMLElement, markdown: string): Promise<Editor> {
  const [{ Editor, rootCtx, defaultValueCtx, remarkStringifyOptionsCtx }, { commonmark }, { gfm }, { history }] = await Promise.all([
    import('@milkdown/kit/core'),
    import('@milkdown/kit/preset/commonmark'),
    import('@milkdown/kit/preset/gfm'),
    import('@milkdown/kit/plugin/history'),
  ])
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
      ctx.update(remarkStringifyOptionsCtx, prev => ({ ...prev, ...stringifyOptions(markdown) }))
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .create()
}

async function markdownOf(editor: Editor): Promise<string> {
  const { getMarkdown } = await import('@milkdown/kit/utils')
  return editor.action(getMarkdown()).replace(/\n+$/, '')
}

/**
 * Open the WYSIWYG editor over the region around `target`. Resolves `false` (and changes
 * nothing) when there's no region or it doesn't round-trip exactly.
 */
export async function openWysiwyg(target: HTMLElement, slideNo: number, content: string): Promise<boolean> {
  if (active)
    return true
  const lines = content.split('\n')
  const found = regionAt(target, lines, slideNo)
  if (!found)
    return false
  const region = found
  const source = lines.slice(...region.range).join('\n')

  const container = document.createElement('div')
  container.className = 'slidev-wysiwyg'
  container.style.display = 'none'
  region.blocks[0].before(container)
  let editor: Editor
  let normalized: string
  try {
    editor = await createEditor(container, source)
    normalized = await markdownOf(editor)
    // Fidelity gate: the editor's serialization must line up with the source line for line, so
    // a save can keep every line the user didn't change byte for byte (`mergeEdited`).
    if (!linesCorrespond(source, normalized)) {
      const a = source.split('\n')
      const b = normalized.split('\n')
      const k = a.findIndex((l, j) => l !== b[j])
      console.warn(`[Slidev] WYSIWYG: region doesn't round-trip line for line, so editing per block. Line ${region.range[0] + k + 1}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`)
      await editor.destroy()
      container.remove()
      return false
    }
  }
  catch (err) {
    console.error('[Slidev] WYSIWYG: editor failed to start', err)
    container.remove()
    return false
  }

  // Swap the rendered blocks for the editor, in place, so the slide's styles apply to it.
  const shown = region.blocks.map(b => b.style.display)
  for (const b of region.blocks)
    b.style.display = 'none'
  container.style.display = ''
  container.querySelector<HTMLElement>('[contenteditable]')?.focus()

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      void finish(false)
    }
    else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault()
      ev.stopPropagation()
      void finish(true)
    }
  }
  function onPointerdown(ev: PointerEvent) {
    if (!container.contains(ev.target as Node))
      void finish(true)
  }
  container.addEventListener('keydown', onKeydown, true)
  document.addEventListener('pointerdown', onPointerdown, true)

  let done = false
  async function finish(commit: boolean) {
    if (done)
      return
    done = true
    active = null
    container.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('pointerdown', onPointerdown, true)
    const edited = commit ? mergeEdited(source, normalized, await markdownOf(editor)) : source
    await editor.destroy()
    container.remove()
    region.blocks.forEach((b, i) => b.style.display = shown[i])
    if (edited === source)
      return
    const next = [...lines.slice(0, region.range[0]), ...edited.split('\n'), ...lines.slice(region.range[1])].join('\n')
    try {
      const res = await fetch(`/__slidev/slides/${slideNo}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ content: next, skipHmr: false }),
      })
      if (!res.ok)
        throw new Error(`Failed to patch slide ${slideNo} (${res.status})`)
      await pushTextEdit(slideNo, changedRange(content, next))
    }
    catch (err) {
      console.error('[Slidev] WYSIWYG: saving failed', err)
    }
  }
  active = { finish }
  return true
}

export function closeWysiwyg(commit: boolean): void {
  void active?.finish(commit)
}
