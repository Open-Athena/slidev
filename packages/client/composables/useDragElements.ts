import type { CSSProperties, DirectiveBinding, InjectionKey, WatchStopHandle } from 'vue'
import type { EditKind, ElementSnapshot, RegisteredState } from './useDragHistory'
import { injectLocal, useWindowFocus } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { injectionCurrentPage, injectionFrontmatter, injectionRenderContext, injectionSlideElement, injectionSlideScale, injectionSlideZoom } from '../constants'
import { slideHeight, slideWidth } from '../env'
import { makeId } from '../logic/utils'
import { editMode } from '../state'
import { directiveInject } from '../utils'
import { paddingOriginWithin, renderedImageRect } from './drag-layout'
// `getVisibleBounds`, `findSnap`, `SNAP_THRESHOLD` moved to `./snap.ts` so the
// snap math is unit-testable without a Vue runtime / vite virtual modules.
// Re-exported below for callers that already import them from this module.
import { findSnap, getVisibleBounds } from './snap'
import {
  discardTopMatching,
  beginEdit as historyBeginEdit,
  bumpEditCommit as historyBumpEdit,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commitEdit as historyCommitEdit,
  discardEdit as historyDiscardEdit,
  initialState as historyInitialState,
  pushEditNow as historyPushEditNow,
  redo as historyRedo,
  undo as historyUndo,
  registerHistoryState,
  unregisterHistoryState,
} from './useDragHistory'
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
  zIndex: () => number
  cropTop: () => number
  cropRight: () => number
  cropBottom: () => number
  cropLeft: () => number
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

export function getSnapTargets(pageNum: number, selfDragId: string | Set<string>) {
  const exclude = typeof selfDragId === 'string' ? new Set([selfDragId]) : selfDragId
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
    if (exclude.has(el.dragId))
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

export { findSnap, getVisibleBounds, SNAP_THRESHOLD } from './snap'

export function useDragElementsUpdater(no: number) {
  if (!(__DEV__ && __SLIDEV_FEATURE_EDITOR__))
    return () => {}

  if (map[no])
    return map[no]

  const { info } = useDynamicSlideInfo(no)

  return map[no] = (id, posStr, type) => {
    if (!info.value)
      return

    // Persistence routes through `useDragHistory` → `/__slidev/state/edit` regardless of the
    // element's data source. We keep the local reactive copy in sync for `frontmatter` so
    // any code reading `frontmatter.dragPos[id]` (e.g. element re-mount) sees the latest.
    // For inline `<v-drag pos="...">` declarations, the markdown stays as-authored; DB
    // overrides at runtime, and `commit-yaml` flushes overrides into `slides.coords.yaml`.
    if (type === 'frontmatter') {
      const frontmatter = info.value.frontmatter
      frontmatter.dragPos ||= {}
      if (frontmatter.dragPos[id] !== posStr)
        frontmatter.dragPos[id] = posStr
    }
  }
}

export function useDragElement(directive: DirectiveBinding | null, posRaw?: string | number | number[], markdownSource?: DragElementMarkdownSource, isArrow = false, flow?: boolean) {
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
  const slideElement = inject(injectionSlideElement) ?? ref()
  const { left: slideLeft, top: slideTop, stop: stopWatchBounds } = useSlideBounds(slideElement)
  const { isPrintMode } = useNav()
  const enabled = ['slide', 'presenter'].includes(renderContext.value) && !isPrintMode.value
  // `flow`: the element keeps its slot in the layout (grid cell, column, flex item) and is shifted
  // with `position: relative`; otherwise it's taken out of the layout with `position: absolute`.
  const flowRequested = flow ?? (directive?.modifiers?.flow || frontmatter.dragLayout === 'flow')
  // An element its author already positioned (`class="absolute right-8"`) isn't in the flow to
  // begin with; it gets absolute semantics either way. Decided at mount, from the author's CSS.
  const flowLayout = ref(flowRequested)

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
  const isInteracting = ref(false)
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
    // `offsetHeight` is the unrotated layout-box height in slide CSS pixels and is
    // not affected by ancestor transforms — so it stays correct during the slide-enter
    // animation (parent scale=0) and when the tab is hidden, where `getBoundingClientRect`
    // collapses to 0×0.
    actualHeight.value = container.value.offsetHeight
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

  // Where `left: 0; top: 0` puts the element, in slide coordinates. Positions are stored in slide
  // coordinates, but CSS offsets are relative to the element's `offsetParent` (absolute), or to
  // its own slot in the layout (flow). Both are (0, 0) for an element placed directly on a slide;
  // they differ inside layouts with positioned containers, like a theme's `.col { position: relative }`.
  const layoutOrigin = ref({ x: 0, y: 0 })
  function measureLayoutOrigin() {
    const el = container.value
    if (!el || !slideElement.value)
      return
    const parentOrigin = paddingOriginWithin(el.offsetParent as HTMLElement | null, slideElement.value)
    if (!parentOrigin)
      return
    // A relatively-positioned element's `offsetLeft` includes its own `left`; subtract the applied
    // offset to get its slot in the layout.
    const origin = flowLayout.value
      ? {
          x: parentOrigin.x + el.offsetLeft - (Number.parseFloat(el.style.left) || 0),
          y: parentOrigin.y + el.offsetTop - (Number.parseFloat(el.style.top) || 0),
        }
      : parentOrigin
    if (Math.abs(origin.x - layoutOrigin.value.x) > 0.5 || Math.abs(origin.y - layoutOrigin.value.y) > 0.5)
      layoutOrigin.value = origin
  }

  const containerStyle = computed(() => {
    let baseStyle: CSSProperties
    if (Number.isFinite(x0.value)) {
      baseStyle = {
        position: flowLayout.value ? 'relative' : 'absolute',
        zIndex: zIndex.value,
        left: `${x0.value - width.value / 2 - layoutOrigin.value.x}px`,
        top: `${y0.value - height.value / 2 - layoutOrigin.value.y}px`,
        width: `${width.value}px`,
        // `auto` (not unset) so layout rules like a theme's `img { height: 100% }` don't stretch it.
        height: autoHeight ? 'auto' : `${height.value}px`,
        // Layout-imposed size limits (e.g. `max-h-72`) would otherwise fight the stored size.
        maxWidth: 'none',
        maxHeight: 'none',
        transformOrigin: 'center center',
        transform: `rotate(${rotate.value}deg)`,
      }
      if (flowLayout.value) {
        // A flex item would otherwise shrink below its stored size when its container is full.
        baseStyle.flexShrink = 0
        // With a fixed width, horizontal margins (e.g. a theme's inline-image `margin: 0 0.15em`)
        // would push the slot past what the layout gave it, widening a grid column. The measured
        // layout origin absorbs the shift, so the element doesn't move.
        baseStyle.marginLeft = 0
        baseStyle.marginRight = 0
        // An image with a percentage max-width contributes nothing to its grid track's min-content
        // width, so enlarging it can't widen its column at a neighbor's expense. Resizes are
        // clamped to the slot (`flowSlotWidth`), so this only bites for sizes stored before that.
        if (container.value?.tagName === 'IMG')
          baseStyle.maxWidth = '100%'
      }
    }
    else if (flowRequested) {
      // Until it's first positioned, a flow element renders exactly as its author laid it out.
      baseStyle = {}
    }
    else {
      baseStyle = {
        position: 'absolute',
        zIndex: zIndex.value,
      }
    }

    // In crop mode, drop the clip-path so the full image is visible (DragControl
    // overlays four dimmer rectangles on the *cropped-out* edges; the in-crop
    // region just shows the original render straight through).
    if (!flowRequested || Number.isFinite(x0.value))
      baseStyle.opacity = 1
    if (!isCropping.value && hasCrop.value) {
      baseStyle.clipPath = `inset(${cropTop.value}% ${cropRight.value}% ${cropBottom.value}% ${cropLeft.value}%)`
    }

    return baseStyle
  })

  // Set by wrappers around fixed-AR content (YouTube iframe, Twitter widget) to lock the
  // wrapper's height to width / lockAspectRatio. Number = the AR (w/h) the content wants
  // to render at; null = no lock (free resize). When set:
  //   - height stays in sync with width × AR (sync watcher below)
  //   - DragControl's corner resize preserves AR; border handles are hidden
  const lockAspectRatio = ref<number | null>(null)

  // Keep height in sync with width / lockAspectRatio. Without this, saved dragPos drifts
  // away from the locked AR.
  watchStopHandles.push(
    watch(
      [width, lockAspectRatio],
      ([w, ar]) => {
        if (ar && Math.abs(height.value - w / ar) > 0.5)
          height.value = w / ar
      },
      { immediate: true },
    ),
  )

  // Undo/redo history is managed globally per-deck (`useDragHistory`); each element exposes
  // its current state through the registered capture/apply hooks below.
  function getCurrentSnapshot(): ElementSnapshot {
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

  function applySnapshot(snapshot: ElementSnapshot) {
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

  const historyState: RegisteredState = {
    page,
    dragId,
    capture: getCurrentSnapshot,
    apply: applySnapshot,
  }

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
        // Bump any pending edit's commit debounce — `historyState.bumpEditCommit` is a no-op
        // unless `beginEdit` was called for this element. The debounce coalesces continuous
        // drags into a single event and captures the final `after` state at quiescence.
        historyBumpEdit(historyState)
      },
    ),
  )

  const activeSnapLines = ref<{ x: number[], y: number[] }>({ x: [], y: [] })

  const state = {
    dragId,
    page,
    dataSource,
    markdownSource,
    isArrow,
    enabled,
    scale,
    zoom,
    autoHeight,
    lockAspectRatio,
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
    isInteracting,
    container,
    containerStyle,
    watchStopHandles,
    activeSnapLines,
    positioned: computed((): boolean => Number.isFinite(x0.value)),
    /**
     * Flow layout: the content width (slide px) of the slot the element sits in, which resizes
     * clamp to so an enlarged element doesn't widen its grid column / squeeze its neighbors.
     * `Infinity` when not in flow layout, rotated, or the slot has no block width.
     */
    flowSlotWidth(): number {
      const parent = container.value?.parentElement
      if (!flowLayout.value || rotate.value % 360 !== 0 || !parent)
        return Number.POSITIVE_INFINITY
      const style = getComputedStyle(parent)
      const content = parent.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      return content > 0 ? content / zoom.value : Number.POSITIVE_INFINITY
    },
    dragging: computed((): boolean => isSelected(state)),
    // Snap alignment: compute snapped position and update guide lines
    // x/y are proposed x0/y0 (full element center); snap uses visible (cropped) bounds
    // excludeIds: dragIds to skip when building snap targets. Defaults to just this
    // element's own dragId. Multi-select group drags pass the full selection so the
    // group doesn't snap to its own members (which would otherwise pin the group to
    // an internal alignment as it moves — visible as constant flicker/jitter around
    // a snap line travelling with the group).
    applySnap(x: number, y: number, metaKey: boolean, excludeIds?: Set<string>): { x: number, y: number } {
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

      const targets = getSnapTargets(page.value, excludeIds ?? dragId)
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
    // Undo/redo: delegates to the deck-global stack in `useDragHistory`.
    canUndo: historyCanUndo,
    canRedo: historyCanRedo,
    // Mark the start of an edit on this element. Captures the current value as `before` and
    // marks a pending edit; the position watcher's `bumpEditCommit` debounces the commit.
    // Pass `kind` to label the entry. Defaults to 'move' for body drags.
    saveSnapshot(kind: EditKind = 'move'): void {
      historyBeginEdit(historyState, kind)
    },
    // Force-commit a pending edit immediately (e.g. on pointerup, before navigating). Captures
    // the current state as `after` and POSTs to the server.
    async commitSnapshot(): Promise<void> {
      await historyCommitEdit(historyState)
    },
    // Drop a pending edit without POSTing. Used by abort paths (pinch detected mid-drag,
    // pointercancel) so a never-committed drag never reaches the server.
    discardSnapshot(): void {
      historyDiscardEdit(historyState)
      // Belt-and-suspenders for any stale pending entries left over from earlier code paths.
      discardTopMatching(page.value, [dragId])
    },
    // One-shot atomic edit: capture `before` from `getCurrentSnapshot()`, then call this
    // *after* mutating to record the new value as `after` in a single POST. Used by zorder
    // and other instantaneous operations that don't have a "drag" lifecycle.
    async pushAtomicEdit(kind: EditKind, before: ElementSnapshot): Promise<void> {
      await historyPushEditNow(page.value, kind, dragId, before)
    },
    undo(): void {
      void historyUndo()
    },
    redo(): void {
      void historyRedo()
    },
    mounted() {
      // Apply DB hydration onto local position refs. This runs in *any* render context
      // (slide / presenter / overview / print) — pure read-from-server, write-to-local with
      // no interaction side-effects. Without this in overview context, the QuickOverview
      // thumbnails render at the YAML-committed positions, which lag the live deck whenever
      // the user has uncommitted edits in `state.db`.
      watchStopHandles.push(
        watch(
          historyInitialState,
          (snap) => {
            const elState = snap?.[String(page.value)]?.[dragId]
            if (elState)
              applySnapshot(elState)
          },
          { immediate: true },
        ),
      )
      // Layout origin matters in every context (overview thumbnails, print/export too), and
      // shifts whenever the layout around the element reflows (images loading, fonts, resizing
      // this element in flow mode).
      if (flowRequested && container.value) {
        // Read the author's `position` from under our own inline one.
        const el = container.value
        const inline = el.style.position
        el.style.position = ''
        const authorPosition = getComputedStyle(el).position
        el.style.position = inline
        flowLayout.value = authorPosition !== 'absolute' && authorPosition !== 'fixed'
      }
      measureLayoutOrigin()
      watchStopHandles.push(watch(containerStyle, measureLayoutOrigin, { flush: 'post' }))
      if (container.value && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => measureLayoutOrigin())
        ro.observe(container.value)
        const parent = container.value.parentElement
        if (parent)
          ro.observe(parent)
        if (slideElement.value)
          ro.observe(slideElement.value)
        watchStopHandles.push(() => ro.disconnect())
      }
      if (!enabled)
        return
      // Set data-drag-positioned so [data-drag-positioned] iframe CSS (width/height: 100%) applies.
      // Doing this in mounted (vs the reactive watcher below) covers the initial render, when the
      // watcher's callback would see container.value === null and skip.
      if (container.value && Number.isFinite(x0.value))
        container.value.dataset.dragPositioned = ''
      updateBounds()
      // Refresh bounds when the element resizes — covers img `load` (intrinsic size
      // changes from 0×0 to natural dims), font reflow, etc.
      if (container.value && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => updateBounds())
        ro.observe(container.value)
        watchStopHandles.push(() => ro.disconnect())
      }
      // Register for snap alignment
      registerDragElement(page.value, {
        dragId,
        x0: () => x0.value,
        y0: () => y0.value,
        width: () => width.value,
        height: () => height.value,
        rotate: () => rotate.value,
        zIndex: () => zIndex.value,
        cropTop: () => cropTop.value,
        cropRight: () => cropRight.value,
        cropBottom: () => cropBottom.value,
        cropLeft: () => cropLeft.value,
      })
      // Register with the deck-global history, so undo/redo can target this element by
      // (slideNo, dragId) even when it's mounted on a non-current slide.
      registerHistoryState(historyState)
      // Elements without dragPos stay in natural document flow until first click
      // (auto-positioned in startDragging)
    },
    unmounted() {
      if (!enabled)
        return
      unregisterDragElement(page.value, dragId)
      unregisterHistoryState(historyState)
      state.stopDragging()
    },
    startDragging(): void {
      if (!enabled || !editMode.value)
        return
      updateBounds()
      measureLayoutOrigin()
      // Auto-position unpositioned elements from their current layout position
      if (!Number.isFinite(x0.value)) {
        let box: { left: number, top: number, width: number, height: number } = {
          left: (bounds.value.left - slideLeft.value) / scale.value,
          top: (bounds.value.top - slideTop.value) / scale.value,
          width: bounds.value.width / scale.value,
          height: bounds.value.height / scale.value,
        }
        // A letterboxed image (`object-fit: contain`, as themes give column images) would
        // otherwise be edited as its whole box: crop would clip the empty bands, and the
        // selection would outline space the picture doesn't fill. Shrink the box to the pixels.
        const el = container.value
        if (el instanceof HTMLImageElement && el.naturalWidth && !rotate.value) {
          const style = getComputedStyle(el)
          const pixels = renderedImageRect(
            box,
            { width: el.naturalWidth, height: el.naturalHeight },
            style.objectFit,
            style.objectPosition,
          )
          box = { left: box.left + pixels.left, top: box.top + pixels.top, width: pixels.width, height: pixels.height }
        }
        // `y0` of an auto-height element is derived from its measured height; set that first.
        if (autoHeight)
          actualHeight.value = box.height
        x0.value = box.left + box.width / 2
        y0.value = box.top + box.height / 2
        width.value = box.width
        height.value = box.height
      }
      else {
        // A flow image stored wider than its slot (sized before resizes were clamped) renders
        // capped at the slot (`max-width: 100%`); fit the stored size to it, keeping its left
        // edge and aspect ratio, so the selection matches what's shown.
        const slot = state.flowSlotWidth()
        if (container.value?.tagName === 'IMG' && width.value > slot + 0.5) {
          state.saveSnapshot('resize')
          const k = slot / width.value
          x0.value -= (width.value - slot) / 2
          y0.value -= height.value * (1 - k) / 2
          width.value = slot
          height.value *= k
        }
      }
      selectElement(state)
    },
    stopDragging(): void {
      if (!enabled)
        return
      isCropping.value = false
      isInteracting.value = false
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
    enterInteractMode(): void {
      if (!enabled)
        return
      isInteracting.value = true
    },
    exitInteractMode(): void {
      isInteracting.value = false
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
    // Leaving edit mode drops the selection (and any crop / iframe-interact mode).
    watch(editMode, (on) => {
      if (!on)
        state.stopDragging()
    }),
    // Toggle data-drag-positioned for CSS iframe sizing (avoids circular dependency with auto-sized containers)
    watch(state.positioned, (positioned) => {
      if (container.value) {
        if (positioned)
          container.value.dataset.dragPositioned = ''
        else
          delete container.value.dataset.dragPositioned
      }
    }, { flush: 'post' }),
  )

  return state
}

export type DragElementState = ReturnType<typeof useDragElement>
