import type { SlidePatch } from '@slidev/types'
import type { CSSProperties, DirectiveBinding, InjectionKey, WatchStopHandle } from 'vue'
import { debounce, ensureSuffix } from '@antfu/utils'
import { injectLocal, useWindowFocus } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { injectionCurrentPage, injectionFrontmatter, injectionRenderContext, injectionSlideElement, injectionSlideScale, injectionSlideZoom } from '../constants'
import { makeId } from '../logic/utils'
import { activeDragElement } from '../state'
import { directiveInject } from '../utils'
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

  const state = {
    dragId,
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
    dragging: computed((): boolean => activeDragElement.value === state),
    mounted() {
      if (!enabled)
        return
      updateBounds()
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
      state.stopDragging()
    },
    startDragging(): void {
      if (!enabled)
        return
      updateBounds()
      activeDragElement.value = state
    },
    stopDragging(): void {
      if (!enabled)
        return
      isCropping.value = false
      if (activeDragElement.value === state)
        activeDragElement.value = null
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
    // Only process if this element is currently active
    if (activeDragElement.value !== state)
      return
    const target = ev.target as HTMLElement
    // Don't deselect if clicking on the DragControl UI
    const dragControlContainer = document.querySelector('#drag-control-container')
    if (dragControlContainer?.contains(target))
      return
    // Don't deselect if clicking on this element or any v-drag element
    if (target?.closest('[data-drag-id]') || container.value?.contains(target))
      return
    state.stopDragging()
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
