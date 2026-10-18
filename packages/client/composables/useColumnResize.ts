import type { HtmlTagRef } from './grid-cols'
import type { DeleteSource } from './useDragHistory'
import { onMounted, onUnmounted, watch } from 'vue'
import { editMode } from '../state'
import {
  colsToTemplate,
  findOpeningTag,
  formatFr,
  formatPercent,
  HTML_ATTR,
  isFlexibleTemplate,
  LAYOUT_COLS_ATTR,
  parseComputedTracks,
  parseHtmlTagRef,
  resizePair,
  setTagGridColumns,
  snapPair,
} from './grid-cols'
import { pushColsEdit } from './useDragHistory'

// Column resizing (dev only). In edit mode, hovering the gap between two grid columns shows a
// handle; dragging it changes the split, releasing saves it, double-clicking resets it to equal
// columns. Hold ⌘ to turn off snapping to ⅓ / φ / ½ / ⅔. Two kinds of grid qualify:
// - a theme layout's grid marked `data-slidev-cols`: the split is saved as the slide's `cols`
//   frontmatter, which `SlideWrapper` passes to the layout as `--slidev-cols`;
// - a block-level HTML tag in the slide's markdown (`data-slidev-html`, from
//   `node/syntax/source-lines.ts`) whose columns are all flexible: the split is written to its
//   inline `grid-template-columns`.
// Both are recorded as `cols` history events, so ⌘Z undoes them.

interface Grid {
  el: HTMLElement
  slideNo: number
  /** `null`: a theme layout's grid (`cols` frontmatter). */
  ref: HtmlTagRef | null
}

interface Boundary {
  grid: Grid
  /** The boundary is between tracks `index` and `index + 1`. */
  index: number
  tracks: number[]
  scale: number
  /** Viewport px. */
  left: number
  right: number
  top: number
  bottom: number
}

/** Hover zone around a gap narrower than this (viewport px). */
const MIN_HIT = 12
const SNAP_PX = 8

function slideNoOf(el: Element): number {
  return Number(el.closest('.slidev-page')?.className.match(/slidev-page-(\d+)/)?.[1])
}

function asGrid(el: HTMLElement): Grid | null {
  const display = getComputedStyle(el).display
  if (display !== 'grid' && display !== 'inline-grid')
    return null
  const slideNo = slideNoOf(el)
  if (!slideNo)
    return null
  if (el.hasAttribute(LAYOUT_COLS_ATTR))
    return { el, slideNo, ref: null }
  const ref = parseHtmlTagRef(el.getAttribute(HTML_ATTR))
  if (!ref)
    return null
  // Only splits a drag can rewrite: an inline template of flexible tracks, or a grid-cols class.
  // Templates from a stylesheet may hold `auto` / fixed tracks this can't see.
  const inline = el.style.gridTemplateColumns
  if (inline ? !isFlexibleTemplate(inline) : !Array.from(el.classList).some(c => c.startsWith('grid-cols-')))
    return null
  return { el, slideNo, ref }
}

function boundariesOf(grid: Grid): Boundary[] {
  const { el } = grid
  const tracks = parseComputedTracks(getComputedStyle(el).gridTemplateColumns)
  if (!tracks || !el.offsetWidth)
    return []
  const rect = el.getBoundingClientRect()
  const scale = rect.width / el.offsetWidth
  const style = getComputedStyle(el)
  const gap = Number.parseFloat(style.columnGap) || 0
  let x = rect.left + (Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)) * scale
  const out: Boundary[] = []
  for (let i = 0; i < tracks.length - 1; i++) {
    x += tracks[i] * scale
    const center = x + gap * scale / 2
    const half = Math.max(gap * scale, MIN_HIT) / 2
    out.push({ grid, index: i, tracks, scale, left: center - half, right: center + half, top: rect.top, bottom: rect.bottom })
    x += gap * scale
  }
  return out
}

/** The innermost qualifying grid boundary under the pointer. */
function boundaryAt(x: number, y: number): Boundary | null {
  const hit = document.elementsFromPoint(x, y).find(e => !e.classList.contains('slidev-cols-handle'))
  for (let el = hit as HTMLElement | null; el && el.id !== 'slide-content'; el = el.parentElement) {
    const grid = asGrid(el)
    if (!grid)
      continue
    const b = boundariesOf(grid).find(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)
    if (b)
      return b
  }
  return null
}

async function fetchSlide(slideNo: number): Promise<{ content: string, frontmatter?: Record<string, unknown> }> {
  const res = await fetch(`/__slidev/slides/${slideNo}.json`)
  if (!res.ok)
    throw new Error(`Failed to fetch slide ${slideNo} (${res.status})`)
  return res.json()
}

async function patchSlide(slideNo: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/__slidev/slides/${slideNo}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ ...body, skipHmr: false }),
  })
  if (!res.ok)
    throw new Error(`Failed to patch slide ${slideNo} (${res.status})`)
}

/** `widths: null` resets to equal columns. Returns false when nothing changed. */
async function save(grid: Grid, widths: number[] | null, count: number): Promise<boolean> {
  const { slideNo, ref, el } = grid
  const slide = await fetchSlide(slideNo)
  if (!ref) {
    const before = slide.frontmatter?.cols ?? null
    const after = widths ? formatPercent(widths) : null
    if (String(before) === String(after))
      return false
    await patchSlide(slideNo, { frontmatter: { cols: after } })
    await pushColsEdit(slideNo, { lineRange: [0, 0], lines: [], frontmatter: { key: 'cols', before, after } })
    return true
  }
  const { content } = slide
  const at = findOpeningTag(content, ref)
  const tag = at && content.slice(at.start, at.end)
  // Guard against a stale or wrong mapping: the source tag must name the element's tag and classes.
  const name = tag?.match(/^<([\w-]+)/)?.[1].toLowerCase()
  const classes = tag?.match(/\sclass=(["'])(.*?)\1/s)?.[2].split(/\s+/).filter(Boolean) ?? []
  if (!at || !tag || name !== el.tagName.toLowerCase() || !classes.every(c => el.classList.contains(c)))
    throw new Error(`Grid tag at line ${ref.line + 1} (#${ref.index}) doesn't match the element`)
  const value = widths ? formatFr(widths) : Array.from({ length: count }).fill('1fr').join(' ')
  const nextTag = setTagGridColumns(tag, value)
  if (nextTag === tag)
    return false
  const next = content.slice(0, at.start) + nextTag + content.slice(at.end)
  const start = ref.line
  const end = content.slice(0, at.end).split('\n').length
  const source: DeleteSource = {
    lineRange: [start, end],
    lines: content.split('\n').slice(start, end),
    after: next.split('\n').slice(start, end),
  }
  await patchSlide(slideNo, { content: next })
  await pushColsEdit(slideNo, source)
  return true
}

function flashError(el: HTMLElement) {
  el.dataset.slidevTextError = ''
  setTimeout(() => delete el.dataset.slidevTextError, 1200)
}

/** Put back the grid's authored inline style once `--slidev-cols` shows the saved split. */
function clearPreviewWhenApplied(el: HTMLElement, originalStyle: string | null, expected: string) {
  const restore = () => {
    if (originalStyle == null)
      el.removeAttribute('style')
    else
      el.setAttribute('style', originalStyle)
  }
  const started = Date.now()
  const poll = () => {
    if (getComputedStyle(el).getPropertyValue('--slidev-cols').trim() === expected || Date.now() - started > 3000)
      restore()
    else
      setTimeout(poll, 50)
  }
  poll()
}

function createHandle(): { handle: HTMLElement, label: HTMLElement } {
  const handle = document.createElement('div')
  handle.className = 'slidev-cols-handle'
  handle.title = 'Drag to resize columns (⌘: no snapping), double-click to reset'
  const label = document.createElement('div')
  label.className = 'slidev-cols-label'
  handle.appendChild(label)
  handle.hidden = true
  document.body.appendChild(handle)
  return { handle, label }
}

export function useColumnResize() {
  let handle: HTMLElement | null = null
  let label: HTMLElement | null = null
  let hovered: Boundary | null = null
  let dragging = false
  let frame = 0

  function place(b: Boundary) {
    Object.assign(handle!.style, {
      left: `${b.left}px`,
      top: `${b.top}px`,
      width: `${b.right - b.left}px`,
      height: `${b.bottom - b.top}px`,
    })
    handle!.hidden = false
  }

  function hide() {
    hovered = null
    if (handle)
      handle.hidden = true
  }

  function onPointermove(ev: PointerEvent) {
    if (!editMode.value || dragging || ev.buttons !== 0 || ev.pointerType === 'touch')
      return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const b = boundaryAt(ev.clientX, ev.clientY)
      if (!b)
        return hide()
      hovered = b
      place(b)
    })
  }

  function onHandlePointerdown(ev: PointerEvent) {
    // Re-measure: the slide's scale or layout may have changed since the hover placed the handle
    // (e.g. a slide transition still running then), and the drag math needs current values.
    const b = hovered && boundariesOf(hovered.grid)[hovered.index]
    if (!b || ev.button !== 0)
      return
    ev.preventDefault()
    ev.stopPropagation()
    const { grid, index, tracks, scale } = b
    const { el } = grid
    const originalStyle = el.getAttribute('style')
    const total = tracks.reduce((a, c) => a + c, 0)
    const min = Math.min(0.15 * total, total / tracks.length / 2)
    const pair = tracks[index] + tracks[index + 1]
    const startX = ev.clientX
    let widths: number[] | null = null
    dragging = true
    handle!.setPointerCapture(ev.pointerId)
    handle!.dataset.active = ''

    const restore = () => {
      if (originalStyle == null)
        el.removeAttribute('style')
      else
        el.setAttribute('style', originalStyle)
    }
    const onMove = (e: PointerEvent) => {
      const delta = (e.clientX - startX) / scale
      if (!widths && Math.abs(e.clientX - startX) < 3)
        return
      const next = resizePair(tracks, index, delta, min)
      let snapped: string | null = null
      if (!e.metaKey) {
        const s = snapPair(next[index], pair, SNAP_PX / scale)
        if (s.label && s.left >= min && pair - s.left >= min) {
          next[index] = s.left
          next[index + 1] = pair - s.left
          snapped = s.label
        }
      }
      widths = next
      el.style.gridTemplateColumns = next.map(w => `${w}fr`).join(' ')
      const shift = (next[index] - tracks[index]) * scale
      handle!.style.transform = `translateX(${shift}px)`
      label!.textContent = (grid.ref ? formatFr(next) : formatPercent(next).replace(/\//g, ' / ')) + (snapped ? `  ${snapped}` : '')
    }
    let done = false
    function finish(commit: boolean) {
      if (done)
        return
      done = true
      dragging = false
      handle!.removeEventListener('pointermove', onMove)
      handle!.removeEventListener('pointerup', onUp)
      handle!.removeEventListener('lostpointercapture', onLost)
      window.removeEventListener('keydown', onKey, true)
      delete handle!.dataset.active
      handle!.style.transform = ''
      label!.textContent = ''
      // A click without a drag keeps the handle up, so the second click of a double-click lands on it.
      if (widths)
        hide()
      if (!commit || !widths) {
        restore()
        return
      }
      void commitSave(grid, widths, tracks.length, restore, originalStyle)
    }
    function onUp() {
      finish(true)
    }
    // Capture lost without a pointerup (e.g. the window lost focus): keep the split shown.
    function onLost() {
      finish(true)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(false)
      }
    }
    handle!.addEventListener('pointermove', onMove)
    handle!.addEventListener('pointerup', onUp)
    handle!.addEventListener('lostpointercapture', onLost)
    window.addEventListener('keydown', onKey, true)
  }

  async function commitSave(grid: Grid, widths: number[] | null, count: number, restore: () => void, originalStyle: string | null) {
    try {
      const changed = await save(grid, widths, count)
      if (!changed)
        restore()
      else if (!grid.ref)
        clearPreviewWhenApplied(grid.el, originalStyle, widths ? colsToTemplate(formatPercent(widths))! : '')
    }
    catch (err) {
      console.error('[Slidev] Saving column split failed:', err)
      restore()
      flashError(grid.el)
    }
  }

  function onHandleDblclick(ev: MouseEvent) {
    const b = hovered
    if (!b)
      return
    ev.preventDefault()
    ev.stopPropagation()
    const { el } = b.grid
    void commitSave(b.grid, null, b.tracks.length, () => {}, el.getAttribute('style'))
    hide()
  }

  onMounted(() => {
    ;({ handle, label } = createHandle())
    handle.addEventListener('pointerdown', onHandlePointerdown)
    handle.addEventListener('dblclick', onHandleDblclick)
    document.addEventListener('pointermove', onPointermove, { passive: true })
  })
  onUnmounted(() => {
    document.removeEventListener('pointermove', onPointermove)
    cancelAnimationFrame(frame)
    handle?.remove()
    handle = label = null
  })
  watch(editMode, (on) => {
    if (!on)
      hide()
  })
}
