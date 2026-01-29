import type { App } from 'vue'
import type { DragElementState } from '../composables/useDragElements'
import { watch } from 'vue'
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
          state.watchStopHandles.push(
            watch(state.containerStyle, (style) => {
              for (const [k, v] of Object.entries(style)) {
                if (v)
                  el.style[k as any] = v as any
              }
            }, { immediate: true }),
          )
          function handlePointerdown(ev: PointerEvent) {
            if (ev.button !== 0)
              return
            // Prevent link navigation and start dragging immediately
            ev.preventDefault()
            ev.stopPropagation()
            ev.stopImmediatePropagation()
            state.startDragging()
            // Store initial pointer position for immediate drag
            const startX = ev.clientX
            const startY = ev.clientY
            const startX0 = state.x0.value
            const startY0 = state.y0.value

            function handlePointermove(moveEv: PointerEvent) {
              moveEv.preventDefault()
              // Calculate delta and update position
              const scale = state.zoom.value
              const dx = (moveEv.clientX - startX) / scale
              const dy = (moveEv.clientY - startY) / scale
              state.x0.value = startX0 + dx
              state.y0.value = startY0 + dy
            }

            function handlePointerup() {
              document.removeEventListener('pointermove', handlePointermove)
              document.removeEventListener('pointerup', handlePointerup)
            }

            document.addEventListener('pointermove', handlePointermove)
            document.addEventListener('pointerup', handlePointerup)
          }

          // Prevent click from following links
          function handleClick(ev: MouseEvent) {
            ev.preventDefault()
            ev.stopPropagation()
          }

          el.addEventListener('pointerdown', handlePointerdown, { capture: true })
          el.addEventListener('click', handleClick, { capture: true })
          ;(el as any)._vDragPointerdownHandler = handlePointerdown
          ;(el as any)._vDragClickHandler = handleClick
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
