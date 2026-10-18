import type { App } from 'vue'
import type { DragElementState } from '../composables/useDragElements'
import { watch } from 'vue'
import { handleBodyDragPointerdown } from '../composables/useBodyDragHandler'
import { useDragElement } from '../composables/useDragElements'

export function createVDragDirective() {
  return {
    install(app: App) {
      app.directive<HTMLElement & { draggingState: DragElementState }>('drag', {
        // @ts-expect-error extra prop
        name: 'v-drag',

        created(el, binding, vnode) {
          const state = useDragElement(binding, binding.value, vnode.props?.markdownSource)
          if (vnode.props) {
            vnode.props = { ...vnode.props }
            delete vnode.props.markdownSource
          }
          state.container.value = el
          el.draggingState = state
          el.dataset.dragId = state.dragId
          if (state.enabled)
            el.dataset.dragEditing = ''
          // Opt-in AR lock via `data-lock-ar` attribute (numeric width/height ratio). Used
          // for `<img v-drag>` on shapes whose natural AR we want preserved during resize.
          // Read from vnode.props since the `created` hook fires before HTML attributes are
          // applied to `el` — `el.dataset.lockAr` would be undefined here.
          const lockARRaw = vnode.props?.['data-lock-ar']
          const lockAR = lockARRaw != null ? Number(lockARRaw) : Number.NaN
          if (Number.isFinite(lockAR) && lockAR > 0)
            state.lockAspectRatio.value = lockAR
          state.watchStopHandles.push(
            watch(state.containerStyle, (style) => {
              for (const [k, v] of Object.entries(style)) {
                if (v !== undefined && v !== null)
                  el.style[k as any] = v as any
              }
            }, { immediate: true }),
            watch(state.isInteracting, (interacting) => {
              if (interacting)
                el.dataset.dragInteract = ''
              else
                delete el.dataset.dragInteract
            }),
          )
          function handlePointerdown(ev: PointerEvent) {
            handleBodyDragPointerdown(ev, { state })
          }

          // Prevent click from following links
          function handleClick(ev: MouseEvent) {
            ev.preventDefault()
            ev.stopPropagation()
          }

          // Double-click to enter crop mode (images) or interact mode (iframes).
          // Crop mode renders preview <img>s of the wrapped image, so it only makes sense
          // when there's actually an image to clip — otherwise the user just sees an empty
          // blue rectangle floating over the slide.
          function handleDblclick(ev: MouseEvent) {
            ev.preventDefault()
            ev.stopPropagation()
            if (state.isArrow)
              return
            if (el.querySelector('iframe'))
              state.enterInteractMode()
            else if (el.tagName === 'IMG' || el.querySelector('img'))
              state.enterCropMode()
          }

          el.addEventListener('pointerdown', handlePointerdown, { capture: true })
          el.addEventListener('click', handleClick, { capture: true })
          el.addEventListener('dblclick', handleDblclick, { capture: true })
          ;(el as any)._vDragPointerdownHandler = handlePointerdown
          ;(el as any)._vDragClickHandler = handleClick
          ;(el as any)._vDragDblclickHandler = handleDblclick
        },
        mounted(el) {
          el.draggingState.mounted()

          // Add handler to parent anchor if one exists (must be in mounted when DOM is ready)
          const parentAnchor = el.closest('a')
          if (parentAnchor) {
            // Prevent anchor click from navigating
            function handleAnchorClick(ev: MouseEvent) {
              ev.preventDefault()
              ev.stopPropagation()
            }
            parentAnchor.addEventListener('click', handleAnchorClick, { capture: true })
            ;(el as any)._vDragParentAnchor = parentAnchor
            ;(el as any)._vDragAnchorClickHandler = handleAnchorClick
          }
        },
        unmounted(el) {
          const state = el.draggingState
          state.unmounted()
          const pointerdownHandler = (el as any)._vDragPointerdownHandler
          if (pointerdownHandler)
            el.removeEventListener('pointerdown', pointerdownHandler, { capture: true })
          const clickHandler = (el as any)._vDragClickHandler
          if (clickHandler)
            el.removeEventListener('click', clickHandler, { capture: true })
          const dblclickHandler = (el as any)._vDragDblclickHandler
          if (dblclickHandler)
            el.removeEventListener('dblclick', dblclickHandler, { capture: true })
          const parentAnchor = (el as any)._vDragParentAnchor
          const anchorClickHandler = (el as any)._vDragAnchorClickHandler
          if (parentAnchor && anchorClickHandler)
            parentAnchor.removeEventListener('click', anchorClickHandler, { capture: true })
          state.watchStopHandles.forEach(fn => fn())
        },
      })
    },
  }
}
