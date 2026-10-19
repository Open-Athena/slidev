import type { ListEditResult, ListFocus } from './list-edit'
import type { LineRange } from './text-edit'
import { onMounted, onUnmounted, watch } from 'vue'
import { configs } from '../env'
import { getSlide } from '../logic/slides'
import { editMode } from '../state'
import { changedRange, indentItem, mergeIntoPrevious, moveItem, outdentItem, removeItem, splitItem } from './list-edit'
import {
  blockSourceText,
  cellSourceText,
  looksLikeSameBlock,
  MD_ATTR,
  MD_CELL_ATTR,
  parseLineRange,
  replaceBlockText,
  replaceTableCell,
  serializeInline,
} from './text-edit'
import { pushTextEdit } from './useDragHistory'
import { clearSelection } from './useMultiSelect'
import { closeWysiwyg, isWysiwygEditing, openWysiwyg } from './useWysiwyg'

// In-app text editing (dev only). In edit mode, double-click a heading, paragraph, list item or
// table cell to edit it:
// - in place, as rich text (⌘B / ⌘I), when its markdown round-trips through the rendered DOM;
// - otherwise, or with ⌥ held, as raw markdown in a box over the block.
// Enter saves (Shift+Enter: new line), and so do Esc and clicking away (⌘Z undoes). The edit is written to
// the block's source lines (from the `data-slidev-md` attributes `node/syntax/source-lines.ts`
// adds) and recorded as a `text` history event, so ⌘Z undoes it.
// In a list item, Enter splits it (or ends the list, on an empty item), Backspace at its start
// merges it into the item above, Tab / ⇧Tab indent / outdent it and ⌥↑ / ⌥↓ move it, then
// editing continues in the resulting item (`list-edit.ts` rewrites the lines).

interface Target {
  el: HTMLElement
  slideNo: number
  range: LineRange
  cell: number | null
}

interface Session {
  finish: (commit: boolean) => Promise<void>
}

let session: Session | null = null

function findTarget(ev: MouseEvent): Target | null {
  let target = ev.target as HTMLElement | null
  // Between blocks (e.g. the gap between list items) the target is the container, but the browser
  // still selects the nearest word; edit the block holding that word.
  if (target && !target.closest(`[${MD_ATTR}]`)) {
    const caret = document.caretRangeFromPoint?.(ev.clientX, ev.clientY)?.startContainer
    const caretEl = caret?.nodeType === Node.TEXT_NODE ? caret.parentElement : caret as HTMLElement | undefined
    if (caretEl && target.contains(caretEl))
      target = caretEl
  }
  const el = target?.closest<HTMLElement>(`[${MD_ATTR}]`)
  if (!el || !el.closest('#slide-content'))
    return null
  // A double-click on an image (or other draggable) inside the block is for crop / interact.
  const drag = target!.closest('[data-drag-id]')
  if (drag && el.contains(drag))
    return null
  const range = parseLineRange(el.getAttribute(MD_ATTR))
  const slideNo = Number(el.closest('.slidev-page')?.className.match(/slidev-page-(\d+)/)?.[1])
  if (!range || !slideNo)
    return null
  const cellAttr = el.getAttribute(MD_CELL_ATTR)
  return { el, slideNo, range, cell: cellAttr == null ? null : Number(cellAttr) }
}

async function fetchContent(slideNo: number): Promise<string> {
  const res = await fetch(`/__slidev/slides/${slideNo}.json`)
  if (!res.ok)
    throw new Error(`Failed to fetch slide ${slideNo} (${res.status})`)
  return (await res.json() as { content: string }).content
}

function sourceTextOf(t: Target, content: string): string {
  return t.cell == null ? blockSourceText(content, t.range) : cellSourceText(content, t.range[0], t.cell)
}

// A block's inline content as markdown, minus the whitespace around it (a tight list item's
// text node ends with the newline before its nested list).
function serializeBlock(el: HTMLElement): string | null {
  return serializeInline(el)?.trim() ?? null
}

async function save(t: Target, content: string, newText: string): Promise<void> {
  const next = t.cell == null
    ? replaceBlockText(content, t.range, newText)
    : replaceTableCell(content, t.range[0], t.cell, newText)
  if (next === content)
    return
  const [start, end] = t.range
  const delta = next.split('\n').length - content.split('\n').length
  const before = content.split('\n').slice(start, end)
  const after = next.split('\n').slice(start, end + delta)
  const res = await fetch(`/__slidev/slides/${t.slideNo}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ content: next, skipHmr: false }),
  })
  if (!res.ok)
    throw new Error(`Failed to patch slide ${t.slideNo} (${res.status})`)
  await pushTextEdit(t.slideNo, { lineRange: [start, end], lines: before, after })
}

function flashError(el: HTMLElement) {
  el.dataset.slidevTextError = ''
  setTimeout(() => delete el.dataset.slidevTextError, 1200)
}

// Snapshot of the block's DOM, so cancelling (or saving, before HMR re-renders the slide) puts
// back the exact nodes Vue holds references to, not equivalent copies.
function snapshotDom(el: HTMLElement): () => void {
  const children = Array.from(el.childNodes)
  const texts: Array<[Text, string]> = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    texts.push([n as Text, (n as Text).data])
  return () => {
    el.replaceChildren(...children)
    for (const [node, data] of texts)
      node.data = data
  }
}

// Text nodes of a block's own text: a list item's nested list (and task checkbox) excluded.
function ownTextNodes(el: HTMLElement): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement?.closest('ul, ol') && n.parentElement.closest('ul, ol') !== el.closest('ul, ol')
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT,
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    nodes.push(n as Text)
  return nodes
}

function ownTextLength(el: HTMLElement): number {
  return ownTextNodes(el).reduce((n, t) => n + t.data.length, 0)
}

/** Put the caret at a text offset in the block's own text (or its end). */
function placeCaret(el: HTMLElement, offset: number | 'end'): void {
  const nodes = ownTextNodes(el)
  const range = document.createRange()
  let left = offset === 'end' ? Number.POSITIVE_INFINITY : offset
  let placed = false
  for (const node of nodes) {
    if (left <= node.data.length) {
      range.setStart(node, left)
      placed = true
      break
    }
    left -= node.data.length
  }
  if (!placed) {
    const last = nodes.at(-1)
    if (last)
      range.setStart(last, last.data.length)
    else
      range.setStart(el, 0)
  }
  range.collapse(true)
  const sel = getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** The block's text before / after the caret, as markdown, and the caret's text offset. */
function splitAtCaret(el: HTMLElement): { before: string, after: string, offset: number, collapsed: boolean } | null {
  const sel = getSelection()
  if (!sel?.rangeCount)
    return null
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer))
    return null
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  const post = document.createRange()
  post.selectNodeContents(el)
  post.setStart(r.endContainer, r.endOffset)
  const before = serializeInline(pre.cloneContents())
  const after = serializeInline(post.cloneContents())
  if (before === null || after === null)
    return null
  return { before: before.replace(/\s+$/, ''), after: after.replace(/^\s+/, '').replace(/\s+$/, ''), offset: pre.toString().length, collapsed: r.collapsed }
}

// Resolves once the slide re-renders after a save (mutations, then a quiet moment), or after 10 s
// (a cold dev server can take seconds to recompile the slide).
function nextRender(slideNo: number): Promise<void> {
  const page = document.querySelector(`.slidev-page-${slideNo}`)
  if (!page)
    return Promise.resolve()
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      clearTimeout(quiet)
      quiet = setTimeout(done, 80)
    })
    function done() {
      observer.disconnect()
      clearTimeout(timeout)
      clearTimeout(quiet)
      resolve()
    }
    observer.observe(page, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [MD_ATTR] })
    timeout = setTimeout(done, 10000)
  })
}

// Write a list edit's result, record it, and continue editing where it says.
async function applyListEdit(t: Target, content: string, res: ListEditResult): Promise<void> {
  if (res.content === content)
    return
  const rendered = nextRender(t.slideNo)
  const res2 = await fetch(`/__slidev/slides/${t.slideNo}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ content: res.content, skipHmr: false }),
  })
  if (!res2.ok)
    throw new Error(`Failed to patch slide ${t.slideNo} (${res2.status})`)
  await pushTextEdit(t.slideNo, changedRange(content, res.content))
  if (res.focus)
    await continueAt(t.slideNo, res.focus, rendered)
}

async function continueAt(slideNo: number, focus: ListFocus, rendered: Promise<void>): Promise<void> {
  await rendered
  // The item may land a moment after the first mutations settle.
  let el: HTMLElement | null | undefined
  for (let tries = 0; tries < 20 && !el; tries++) {
    el = document.querySelector(`.slidev-page-${slideNo}`)?.querySelector<HTMLElement>(`li[${MD_ATTR}^="${focus.line},"]`)
    if (!el)
      await new Promise(r => setTimeout(r, 100))
  }
  const range = parseLineRange(el?.getAttribute(MD_ATTR))
  if (el && range)
    await beginEditing({ el, slideNo, range, cell: null }, false, focus.offset)
}

function startRich(t: Target, content: string, sourceText: string, caret?: number | 'end') {
  const { el } = t
  const restore = snapshotDom(el)
  // List items: only the item's own text is editable, not its nested list.
  const locked = Array.from(el.querySelectorAll<HTMLElement>(':scope > ul, :scope > ol, :scope > input'))
  for (const child of locked)
    child.contentEditable = 'false'
  el.contentEditable = 'true'
  el.dataset.slidevTextEditing = ''
  el.focus()
  if (caret !== undefined)
    placeCaret(el, caret)
  const isItem = el.tagName === 'LI' && t.cell == null

  // A list structure key: compute the op from the edited text, end this session, apply it.
  function listOp(ev: KeyboardEvent): (() => ListEditResult | null) | null {
    const at = splitAtCaret(el)
    if (!at)
      return null
    const [start, end] = t.range
    const text = at.after ? (at.before ? `${at.before}${at.after}` : at.after) : at.before
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey)
      return !at.before && !at.after ? () => removeItem(content, start, end) : () => splitItem(content, start, end, at.before, at.after)
    if (ev.key === 'Backspace' && at.collapsed && !at.before) {
      return () => {
        // Join point: the end of the item above's own text, measured in the rendered slide.
        const probe = mergeIntoPrevious(content, start, end, at.after, 0)
        const prevEl = probe?.focus && el.closest(`.slidev-page-${t.slideNo}`)?.querySelector<HTMLElement>(`li[${MD_ATTR}^="${probe.focus.line},"]`)
        return mergeIntoPrevious(content, start, end, at.after, prevEl ? ownTextLength(prevEl) : 0)
      }
    }
    // Structure ops on unsaved text: save the text into the item first, then apply the op.
    const withText = (op: (c: string) => ListEditResult | null) => () =>
      op(text === sourceText ? content : replaceBlockText(content, t.range, text))
    if (ev.key === 'Tab')
      return withText(c => (ev.shiftKey ? outdentItem : indentItem)(c, start, start + text.split('\n').length, at.offset))
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown'))
      return withText(c => moveItem(c, start, start + text.split('\n').length, ev.key === 'ArrowUp' ? 'up' : 'down', at.offset))
    return null
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.isComposing)
      return
    if (isItem && !ev.metaKey && !ev.ctrlKey && (['Enter', 'Backspace', 'Tab'].includes(ev.key) || (ev.altKey && ev.key.startsWith('Arrow')))) {
      const op = listOp(ev)
      if (op) {
        ev.preventDefault()
        ev.stopPropagation()
        void finishWith(op)
        return
      }
      if (ev.key === 'Tab') {
        ev.preventDefault()
        return
      }
    }
    if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) {
      ev.preventDefault()
      void finish(true)
    }
  }
  // Pasted HTML would bring markup markdown can't hold; paste as plain text.
  function onPaste(ev: ClipboardEvent) {
    ev.preventDefault()
    document.execCommand('insertText', false, ev.clipboardData?.getData('text/plain') ?? '')
  }
  // Any blur saves: clicking away, another window, or an Esc a keyboard extension (Vimium)
  // turns into a bare blur before the page sees the key.
  function onBlur() {
    void finish(true)
  }
  el.addEventListener('keydown', onKeydown)
  el.addEventListener('paste', onPaste)
  el.addEventListener('blur', onBlur)

  let done = false
  function teardown(): boolean {
    if (done)
      return false
    done = true
    session = null
    el.removeEventListener('keydown', onKeydown)
    el.removeEventListener('paste', onPaste)
    el.removeEventListener('blur', onBlur)
    return true
  }
  function release() {
    el.removeAttribute('contenteditable')
    delete el.dataset.slidevTextEditing
    for (const child of locked)
      child.removeAttribute('contenteditable')
    restore()
  }
  async function finishWith(op: () => ListEditResult | null) {
    if (!teardown())
      return
    const res = op()
    release()
    if (!res)
      return
    try {
      await applyListEdit(t, content, res)
    }
    catch (err) {
      console.error('[Slidev] List edit failed:', err)
      flashError(el)
    }
  }
  async function finish(commit: boolean) {
    if (!teardown())
      return
    const newText = commit ? serializeBlock(el) : null
    release()
    if (!commit)
      return
    if (newText === null) {
      console.warn('[Slidev] Text edit discarded: the edited text has formatting markdown can\'t hold')
      flashError(el)
      return
    }
    try {
      if (newText !== sourceText)
        await save(t, content, newText)
    }
    catch (err) {
      console.error('[Slidev] Saving text edit failed:', err)
      flashError(el)
    }
  }
  session = { finish }
}

function startRaw(t: Target, content: string, sourceText: string) {
  const { el } = t
  const rect = el.getBoundingClientRect()
  const scale = el.offsetWidth ? rect.width / el.offsetWidth : 1
  const style = getComputedStyle(el)
  const singleLine = t.cell != null || /^H[1-6]$/.test(el.tagName)

  const box = document.createElement('textarea')
  box.className = 'slidev-text-raw-editor'
  box.value = sourceText
  box.spellcheck = false
  Object.assign(box.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(rect.width, 240)}px`,
    fontSize: `${Number.parseFloat(style.fontSize) * scale * 0.8}px`,
  })
  document.body.appendChild(box)
  const fit = () => {
    box.style.height = 'auto'
    box.style.height = `${Math.max(box.scrollHeight, rect.height)}px`
  }
  fit()
  box.addEventListener('input', fit)
  box.focus()
  box.setSelectionRange(box.value.length, box.value.length)
  el.dataset.slidevTextEditing = ''

  function onKeydown(ev: KeyboardEvent) {
    // ⌘S reaches the global handler, which finishes (saves) this edit and commits.
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's')
      return
    ev.stopPropagation()
    if (ev.isComposing)
      return
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (!ev.shiftKey || singleLine))) {
      ev.preventDefault()
      void finish(true)
    }
  }
  function onBlur() {
    void finish(true)
  }
  box.addEventListener('keydown', onKeydown)
  box.addEventListener('blur', onBlur)

  let done = false
  async function finish(commit: boolean) {
    if (done)
      return
    done = true
    session = null
    box.removeEventListener('blur', onBlur)
    const newText = box.value
    box.remove()
    delete el.dataset.slidevTextEditing
    if (!commit || newText === sourceText)
      return
    try {
      await save(t, content, newText)
    }
    catch (err) {
      console.error('[Slidev] Saving text edit failed:', err)
      flashError(el)
    }
  }
  session = { finish }
}

async function onDblclick(ev: MouseEvent) {
  if (!editMode.value || session || isWysiwygEditing())
    return
  const t = findTarget(ev)
  if (!t)
    return
  ev.preventDefault()
  ev.stopPropagation()
  clearSelection()
  // WYSIWYG (`wysiwyg: true` in the headmatter, or a slide's frontmatter): edit the whole run of markdown blocks when it
  // round-trips exactly; otherwise (or with ⌥) edit this block.
  const wysiwyg = getSlide(t.slideNo)?.meta.slide?.frontmatter.wysiwyg ?? (configs as any).wysiwyg
  if (wysiwyg && !ev.altKey) {
    try {
      if (await openWysiwyg(t.el, t.slideNo, await fetchContent(t.slideNo)))
        return
    }
    catch (err) {
      console.error('[Slidev] WYSIWYG failed; editing per block', err)
    }
  }
  await beginEditing(t, ev.altKey)
}

async function beginEditing(t: Target, raw: boolean, caret?: number | 'end') {
  try {
    const content = await fetchContent(t.slideNo)
    const sourceText = sourceTextOf(t, content)
    if (!looksLikeSameBlock(t.el.textContent ?? '', sourceText)) {
      console.warn('[Slidev] Text edit refused: the block doesn\'t match its source lines', t.range, sourceText)
      flashError(t.el)
      return
    }
    if (!raw && serializeBlock(t.el) === sourceText)
      startRich(t, content, sourceText, caret)
    else
      startRaw(t, content, sourceText)
  }
  catch (err) {
    console.error('[Slidev] Starting text edit failed:', err)
    flashError(t.el)
  }
}

export function useTextEditing() {
  onMounted(() => {
    // Capture phase, so a double-click on text inside a draggable box edits the text rather
    // than entering the box's crop / interact mode.
    document.addEventListener('dblclick', onDblclick, true)
  })
  onUnmounted(() => {
    document.removeEventListener('dblclick', onDblclick, true)
    void session?.finish(false)
  })
  // Editable blocks get a hover hint while editing (see `styles/index.css`); leaving edit mode
  // saves any edit in progress.
  watch(editMode, (on) => {
    document.documentElement.classList.toggle('slidev-edit-mode', on)
    if (!on) {
      void session?.finish(true)
      closeWysiwyg(true)
    }
  }, { immediate: true })
}
