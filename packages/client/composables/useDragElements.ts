import type { SlidePatch } from '@slidev/types'
import type { CSSProperties, DirectiveBinding, InjectionKey, WatchStopHandle } from 'vue'
import { debounce, ensureSuffix } from '@antfu/utils'
import { injectLocal, useSessionStorage, useWindowFocus } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { injectionCurrentPage, injectionFrontmatter, injectionRenderContext, injectionSlideElement, injectionSlideScale, injectionSlideZoom } from '../constants'
import { slideHeight, slideWidth } from '../env'
import { makeId } from '../logic/utils'
import { directiveInject } from '../utils'
import { clearSelection, isSelected, removeFromSelection, selectElement } from './useMultiSelect'
import { useNav } from './useNav'
import { useSlideBounds } from './useSlideBounds'
import { useDynamicSlideInfo } from './useSlideInfo'

export type DragElementDataSource = 'frontmatter' | 'prop' | 'directive'
/**
 * Markdown source position, injected by markdown-it plugin
 */
export type DragElementMarkdownSource = [startLine: number, endLine: number, index: number]

export type DragElementsUpdater = (id: string, posStr: string, type: DragElementDataSource, markdownSource?: DragElementMarkdownSource) => void

const map: Record<number, DragElementsUpdater> = {}

// Registry of all drag elements per page for snap alignment
export interface DragElementInfo {
  dragId: string
  x0: () => number
  y0: () => number
  width: () => number
  height: () => number
  rotate: () => number
  cropTop: () => number
  cropRight: () => number
  cropBottom: () => number
  cropLeft: () => number
}

// Compute visible (cropped) center and dimensions for an element
function getVisibleBounds(el: DragElementInfo) {
  const w = el.width()
  const h = el.height()
  const cT = el.cropTop()
  const cR = el.cropRight()
  const cB = el.cropBottom()
  const cL = el.cropLeft()
  const visW = w * (100 - cL - cR) / 100
  const visH = h * (100 - cT - cB) / 100
  // Crop offset in local coords (before rotation)
  const offX = (cL - cR) / 100 * w / 2
  const offY = (cT - cB) / 100 * h / 2
  const rad = el.rotate() * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // Visible center in world coords
  const cx = el.x0() + offX * cos - offY * sin
  const cy = el.y0() + offX * sin + offY * cos
  return { cx, cy, w: visW, h: visH }
}
const dragElementRegistry: Map<number, Map<string, DragElementInfo>> = new Map()

export function getDragElementsForPage(page: number): DragElementInfo[] {
  const pageElements = dragElementRegistry.get(page)
  return pageElements ? Array.from(pageElements.values()) : []
}

function registerDragElement(page: number, info: DragElementInfo) {
  if (!dragElementRegistry.has(page))
    dragElementRegistry.set(page, new Map())
  dragElementRegistry.get(page)!.set(info.dragId, info)
}

function unregisterDragElement(page: number, dragId: string) {
  dragElementRegistry.get(page)?.delete(dragId)
}

// Snap alignment logic
const SNAP_THRESHOLD = 8

export function getSnapTargets(pageNum: number, selfDragId: string) {
  const targets = { x: new Set<number>(), y: new Set<number>() }

  // Slide edges and center
  targets.x.add(0)
  targets.x.add(slideWidth.value / 2)
  targets.x.add(slideWidth.value)
  targets.y.add(0)
  targets.y.add(slideHeight.value / 2)
  targets.y.add(slideHeight.value)

  // Other elements on this page (use visible/cropped bounds)
  const elements = getDragElementsForPage(pageNum)
  for (const el of elements) {
    if (el.dragId === selfDragId)
      continue
    const { cx, cy, w, h } = getVisibleBounds(el)
    targets.x.add(cx - w / 2)
    targets.x.add(cx)
    targets.x.add(cx + w / 2)
    targets.y.add(cy - h / 2)
    targets.y.add(cy)
    targets.y.add(cy + h / 2)
  }

  return { x: Array.from(targets.x), y: Array.from(targets.y) }
}

export function findSnap(value: number, elementHalfSize: number, targets: number[]): { value: number, lines: number[] } {
  let best: { dist: number, val: number, line: number } | null = null

  const leftEdge = value - elementHalfSize
  const rightEdge = value + elementHalfSize

  for (const t of targets) {
    const centerDist = Math.abs(value - t)
    if (centerDist < SNAP_THRESHOLD && (!best || centerDist < best.dist))
      best = { dist: centerDist, val: t, line: t }

    const leftDist = Math.abs(leftEdge - t)
    if (leftDist < SNAP_THRESHOLD && (!best || leftDist < best.dist))
      best = { dist: leftDist, val: t + elementHalfSize, line: t }

    const rightDist = Math.abs(rightEdge - t)
    if (rightDist < SNAP_THRESHOLD && (!best || rightDist < best.dist))
      best = { dist: rightDist, val: t - elementHalfSize, line: t }
  }

  return best ? { value: best.val, lines: [best.line] } : { value, lines: [] }
}

export function useDragElementsUpdater(no: number) {
  if (!(__DEV__ && __SLIDEV_FEATURE_EDITOR__))
    return () => {}

  if (map[no])
    return map[no]

  const { info, update } = useDynamicSlideInfo(no)

  let newPatch: SlidePatch | null = null
  async function save() {
    if (newPatch) {
      await update({
        ...newPatch,
        skipHmr: true,
      })
      newPatch = null
    }
  }
  const debouncedSave = debounce(500, save)

  return map[no] = (id, posStr, type, markdownSource) => {
    if (!info.value)
      return

    if (type === 'frontmatter') {
      const frontmatter = info.value.frontmatter
      frontmatter.dragPos ||= {}
      if (frontmatter.dragPos[id] === posStr)
        return
      frontmatter.dragPos[id] = posStr
      newPatch = {
        frontmatter: {
          dragPos: frontmatter.dragPos,
        },
      }
    }
    else {
      if (!markdownSource)
        throw new Error(`[Slidev] VDrag Element ${id} is missing markdown source`)

      const [startLine, endLine, idx] = markdownSource
      const lines = info.value.content.split(/\r?\n/g)

      let section = lines.slice(startLine, endLine).join('\n')
      let replaced = false

      section = type === 'prop'
      // eslint-disable-next-line regexp/no-super-linear-backtracking
        ? section.replace(/<(v-?drag-?\w*)(.*?)(\/)?>/gi, (full, tag, attrs, selfClose = '', index) => {
            if (index === idx) {
              replaced = true
              const posMatch = attrs.match(/pos=".*?"/)
              if (!posMatch)
                return `<${tag}${ensureSuffix(' ', attrs)}pos="${posStr}"${selfClose}>`
              const start = posMatch.index
              const end = start + posMatch[0].length
              return `<${tag}${attrs.slice(0, start)}pos="${posStr}"${attrs.slice(end)}${selfClose}>`
            }
            return full
          })
        : section.replace(/(?<![</\w])v-drag(?:=".*?")?/gi, (full, index) => {
            if (index === idx) {
              replaced = true
              return `v-drag="${posStr}"`
            }
            return full
          })

      if (!replaced)
        throw new Error(`[Slidev] VDrag Element ${id} is not found in the markdown source`)

      lines.splice(
        startLine,
        endLine - startLine,
        section,
      )

      const newContent = lines.join('\n')
      if (info.value.content === newContent)
        return
      newPatch = {
        content: newContent,
      }
      info.value = {
        ...info.value,
        content: newContent,
      }
    }
    debouncedSave()
  }
}

export function useDragElement(directive: DirectiveBinding | null, posRaw?: string | number | number[], markdownSource?: DragElementMarkdownSource, isArrow = false) {
  function inject<T>(key: InjectionKey<T> | string): T | undefined {
    return directive
      ? directiveInject(directive, key)
      : injectLocal(key)
  }

  const renderContext = inject(injectionRenderContext)!
  const frontmatter = inject(injectionFrontmatter) ?? {}
  const page = inject(injectionCurrentPage)!
  const updater = computed(() => useDragElementsUpdater(page.value))
  const scale = inject(injectionSlideScale) ?? ref(1)
  const zoom = inject(injectionSlideZoom) ?? ref(1)
  const { left: slideLeft, top: slideTop, stop: stopWatchBounds } = useSlideBounds(inject(injectionSlideElement) ?? ref())
  const { isPrintMode } = useNav()
  const enabled = ['slide', 'presenter'].includes(renderContext.value) && !isPrintMode.value

  let dataSource: DragElementDataSource = directive ? 'directive' : 'prop'
  let dragId: string = makeId()
  let pos: number[] | undefined
  if (Array.isArray(posRaw)) {
    pos = posRaw
  }
  else if (typeof posRaw === 'string' && posRaw.includes(',')) {
    pos = posRaw.split(',').map(Number)
  }
  else if (posRaw != null) {
    dataSource = 'frontmatter'
    dragId = `${posRaw}`
    posRaw = frontmatter?.dragPos?.[dragId]
    pos = (posRaw as string)?.split(',').map(Number)
  }

  if (dataSource !== 'frontmatter' && !markdownSource)
    throw new Error('[Slidev] Can not identify the source position of the v-drag element, please provide an explicit `id` prop.')

  const watchStopHandles: WatchStopHandle[] = [stopWatchBounds]

  const autoHeight = !isArrow && posRaw != null && !Number.isFinite(pos?.[3])
  pos ??= [Number.NaN, Number.NaN, 0]
  const width = ref(pos[2])
  const x0 = ref(pos[0] + pos[2] / 2)

  const rotate = ref(isArrow ? 0 : (pos[4] ?? 0))
  const zIndex = ref(pos[5] ?? 100)

  // Crop values (percentages from each edge, 0-100)
  const cropTop = ref(pos[6] ?? 0)
  const cropRight = ref(pos[7] ?? 0)
  const cropBottom = ref(pos[8] ?? 0)
  const cropLeft = ref(pos[9] ?? 0)
  const isCropping = ref(false)
  const rotateRad = computed(() => rotate.value * Math.PI / 180)
  const rotateSin = computed(() => Math.sin(rotateRad.value))
  const rotateCos = computed(() => Math.cos(rotateRad.value))

  const container = ref<HTMLElement>()
  const bounds = ref({ left: 0, top: 0, width: 0, height: 0 })
  const actualHeight = ref(0)
  function updateBounds() {
    if (!container.value)
      return
    const rect = container.value.getBoundingClientRect()
    bounds.value = {
      left: rect.left / zoom.value,
      top: rect.top / zoom.value,
      width: rect.width / zoom.value,
      height: rect.height / zoom.value,
    }
    actualHeight.value = ((bounds.value.width + bounds.value.height) / scale.value / (Math.abs(rotateSin.value) + Math.abs(rotateCos.value)) - width.value)
  }
  watchStopHandles.push(watch(width, updateBounds, { flush: 'post' }))

  const configuredHeight = ref(pos[3] ?? 0)
  const height = autoHeight
    ? computed({
        get: () => (autoHeight ? actualHeight.value : configuredHeight.value) || 0,
        set: v => !autoHeight && (configuredHeight.value = v),
      })
    : configuredHeight
  const configuredY0 = autoHeight ? ref(pos[1]) : ref(pos[1] + pos[3] / 2)
  const y0 = autoHeight
    ? computed({
        get: () => configuredY0.value + height.value / 2,
        set: v => configuredY0.value = v - height.value / 2,
      })
    : configuredY0

  // Check if any crop is applied
  const hasCrop = computed(() =>
    cropTop.value !== 0 || cropRight.value !== 0 || cropBottom.value !== 0 || cropLeft.value !== 0,
  )

  const containerStyle = computed(() => {
    const baseStyle: CSSProperties = Number.isFinite(x0.value)
      ? {
          position: 'absolute',
          zIndex: zIndex.value,
          left: `${x0.value - width.value / 2}px`,
          top: `${y0.value - height.value / 2}px`,
          width: `${width.value}px`,
          height: autoHeight ? undefined : `${height.value}px`,
          transformOrigin: 'center center',
          transform: `rotate(${rotate.value}deg)`,
        }
      : {
          position: 'absolute',
          zIndex: zIndex.value,
        }

    // In crop mode, hide the original element so only DragControl's preview is visible
    if (isCropping.value) {
      baseStyle.opacity = 0
    }
    else {
      // Reset opacity when not cropping
      baseStyle.opacity = 1
      // Apply crop via clip-path when not in crop mode
      if (hasCrop.value) {
        baseStyle.clipPath = `inset(${cropTop.value}% ${cropRight.value}% ${cropBottom.value}% ${cropLeft.value}%)`
      }
    }

    return baseStyle
  })

  watchStopHandles.push(
    watch(
      [x0, y0, width, height, rotate, zIndex, cropTop, cropRight, cropBottom, cropLeft],
      ([x0, y0, w, h, r, z, cTop, cRight, cBottom, cLeft]) => {
        let posStr = [x0 - w / 2, y0 - h / 2, w].map(Math.round).join()
        if (autoHeight)
          posStr += dataSource === 'directive' ? ',NaN' : ',_'
        else
          posStr += `,${Math.round(h)}`

        // Add rotate if non-zero, or if we need subsequent values
        const hasCrop = cTop !== 0 || cRight !== 0 || cBottom !== 0 || cLeft !== 0
        const hasZIndex = z !== 100
        if (Math.round(r) !== 0 || hasZIndex || hasCrop)
          posStr += `,${Math.round(r)}`

        // Add zIndex if non-default, or if we need crop values
        if (hasZIndex || hasCrop)
          posStr += `,${Math.round(z)}`

        // Add crop values if any are non-zero
        if (hasCrop)
          posStr += `,${Math.round(cTop)},${Math.round(cRight)},${Math.round(cBottom)},${Math.round(cLeft)}`

        if (dataSource === 'directive')
          posStr = `[${posStr}]`

        updater.value(dragId, posStr, dataSource, markdownSource)
      },
    ),
  )

  // Undo/redo history (persisted to sessionStorage)
  interface HistorySnapshot {
    x0: number
    y0: number
    width: number
    height: number
    rotate: number
    zIndex: number
    cropTop: number
    cropRight: number
    cropBottom: number
    cropLeft: number
  }
  const storageKey = `slidev-drag-history-${page.value}-${dragId}`
  const history = useSessionStorage<HistorySnapshot[]>(`${storageKey}-undo`, [])
  const redoStack = useSessionStorage<HistorySnapshot[]>(`${storageKey}-redo`, [])
  const maxHistorySize = 50

  function getCurrentSnapshot(): HistorySnapshot {
    return {
      x0: x0.value,
      y0: y0.value,
      width: width.value,
      height: height.value,
      rotate: rotate.value,
      zIndex: zIndex.value,
      cropTop: cropTop.value,
      cropRight: cropRight.value,
      cropBottom: cropBottom.value,
      cropLeft: cropLeft.value,
    }
  }

  function applySnapshot(snapshot: HistorySnapshot) {
    x0.value = snapshot.x0
    y0.value = snapshot.y0
    width.value = snapshot.width
    height.value = snapshot.height
    rotate.value = snapshot.rotate
    zIndex.value = snapshot.zIndex
    cropTop.value = snapshot.cropTop
    cropRight.value = snapshot.cropRight
    cropBottom.value = snapshot.cropBottom
    cropLeft.value = snapshot.cropLeft
  }

  const activeSnapLines = ref<{ x: number[], y: number[] }>({ x: [], y: [] })

  const state = {
    dragId,
    page,
    dataSource,
    markdownSource,
    isArrow,
    zoom,
    autoHeight,
    x0,
    y0,
    width,
    height,
    rotate,
    zIndex,
    cropTop,
    cropRight,
    cropBottom,
    cropLeft,
    isCropping,
    container,
    containerStyle,
    watchStopHandles,
    activeSnapLines,
    dragging: computed((): boolean => isSelected(state)),
    // Snap alignment: compute snapped position and update guide lines
    // x/y are proposed x0/y0 (full element center); snap uses visible (cropped) bounds
    applySnap(x: number, y: number, metaKey: boolean): { x: number, y: number } {
      if (metaKey) {
        activeSnapLines.value = { x: [], y: [] }
        return { x, y }
      }
      const cT = cropTop.value
      const cR = cropRight.value
      const cB = cropBottom.value
      const cL = cropLeft.value
      const visHalfW = width.value * (100 - cL - cR) / 200
      const visHalfH = height.value * (100 - cT - cB) / 200
      // Crop offset in local coords
      const offX = (cL - cR) / 100 * width.value / 2
      const offY = (cT - cB) / 100 * height.value / 2
      // Visible center from proposed x0/y0
      const visCX = x + offX * rotateCos.value - offY * rotateSin.value
      const visCY = y + offX * rotateSin.value + offY * rotateCos.value

      const targets = getSnapTargets(page.value, dragId)
      const snapX = findSnap(visCX, visHalfW, targets.x)
      const snapY = findSnap(visCY, visHalfH, targets.y)
      activeSnapLines.value = { x: snapX.lines, y: snapY.lines }

      // Convert snapped visible center back to x0/y0
      const newX0 = snapX.value - offX * rotateCos.value + offY * rotateSin.value
      const newY0 = snapY.value - offX * rotateSin.value - offY * rotateCos.value
      return { x: newX0, y: newY0 }
    },
    clearSnapLines(): void {
      activeSnapLines.value = { x: [], y: [] }
    },
    // Undo/redo (persisted to sessionStorage)
    canUndo: computed(() => history.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    saveSnapshot(): void {
      // Save current state to history (call before making changes)
      history.value.push(getCurrentSnapshot())
      if (history.value.length > maxHistorySize)
        history.value.shift()
      // Clear redo stack when new action is taken
      redoStack.value = []
    },
    undo(): void {
      if (history.value.length === 0)
        return
      // Save current state to redo stack
      redoStack.value.push(getCurrentSnapshot())
      // Restore previous state
      const prev = history.value.pop()!
      applySnapshot(prev)
    },
    redo(): void {
      if (redoStack.value.length === 0)
        return
      // Save current state to history
      history.value.push(getCurrentSnapshot())
      // Restore from redo stack
      const next = redoStack.value.pop()!
      applySnapshot(next)
    },
    mounted() {
      if (!enabled)
        return
      updateBounds()
      // Register for snap alignment
      registerDragElement(page.value, {
        dragId,
        x0: () => x0.value,
        y0: () => y0.value,
        width: () => width.value,
        height: () => height.value,
        rotate: () => rotate.value,
        cropTop: () => cropTop.value,
        cropRight: () => cropRight.value,
        cropBottom: () => cropBottom.value,
        cropLeft: () => cropLeft.value,
      })
      if (!posRaw) {
        setTimeout(() => {
          updateBounds()
          x0.value = (bounds.value.left + bounds.value.width / 2 - slideLeft.value) / scale.value
          y0.value = (bounds.value.top - slideTop.value) / scale.value
          width.value = bounds.value.width / scale.value
          height.value = bounds.value.height / scale.value
        }, 100)
      }
    },
    unmounted() {
      if (!enabled)
        return
      unregisterDragElement(page.value, dragId)
      state.stopDragging()
    },
    startDragging(): void {
      if (!enabled)
        return
      updateBounds()
      selectElement(state)
    },
    stopDragging(): void {
      if (!enabled)
        return
      isCropping.value = false
      removeFromSelection(state)
    },
    // Saved crop values for cancel functionality
    savedCropValues: null as { top: number, right: number, bottom: number, left: number } | null,
    enterCropMode(): void {
      if (!enabled || isArrow)
        return
      // Save current crop values so we can restore on cancel
      state.savedCropValues = {
        top: cropTop.value,
        right: cropRight.value,
        bottom: cropBottom.value,
        left: cropLeft.value,
      }
      isCropping.value = true
    },
    exitCropMode(): void {
      // Commit the crop (don't restore saved values)
      state.savedCropValues = null
      isCropping.value = false
    },
    cancelCropMode(): void {
      // Restore saved crop values and exit
      if (state.savedCropValues) {
        cropTop.value = state.savedCropValues.top
        cropRight.value = state.savedCropValues.right
        cropBottom.value = state.savedCropValues.bottom
        cropLeft.value = state.savedCropValues.left
      }
      state.savedCropValues = null
      isCropping.value = false
    },
  }

  // Handle click-outside-to-deselect with our own listener instead of VueUse's onClickOutside
  // (VueUse's onClickOutside has timing issues with our pointerdown-based selection)
  function handleDocumentPointerdown(ev: PointerEvent) {
    // Only process if this element is currently selected
    if (!isSelected(state))
      return
    // Shift-click on another element should not clear selection (handled by v-drag)
    if (ev.shiftKey) {
      return
    }
    const target = ev.target as HTMLElement
    // Don't deselect if clicking on the DragControl UI or GroupDragControl
    const dragControlContainer = document.querySelector('#drag-control-container')
    const groupDragControlContainer = document.querySelector('#group-drag-control-container')
    if (dragControlContainer?.contains(target) || groupDragControlContainer?.contains(target))
      return
    // Don't deselect if clicking on this element or any v-drag element
    if (target?.closest('[data-drag-id]') || container.value?.contains(target))
      return
    // Clear entire selection when clicking outside
    clearSelection()
  }
  document.addEventListener('pointerdown', handleDocumentPointerdown)
  watchStopHandles.push(() => document.removeEventListener('pointerdown', handleDocumentPointerdown))

  watchStopHandles.push(
    watch(useWindowFocus(), (focused) => {
      if (!focused)
        state.stopDragging()
    }),
  )

  return state
}

export type DragElementState = ReturnType<typeof useDragElement>
