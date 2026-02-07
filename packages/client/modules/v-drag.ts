import type { App } from 'vue'
import type { DragElementState } from '../composables/useDragElements'
import { watch } from 'vue'
import { useDragElement } from '../composables/useDragElements'
import { addToSelection, getSelectedElements, isSelected, removeFromSelection } from '../composables/useMultiSelect'

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
                if (v !== undefined && v !== null)
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

            // Handle multi-select with shift key
            if (ev.shiftKey) {
              // Toggle selection
              if (isSelected(state)) {
                removeFromSelection(state)
              }
              else {
                addToSelection(state)
              }
              return // Don't start drag on shift-click
            }

            // If element is already selected (possibly as part of multi-select),
            // don't replace selection - just proceed with group drag
            const wasAlreadySelected = isSelected(state)
            if (!wasAlreadySelected) {
              state.startDragging() // This calls selectElement, replacing selection
            }

            // Store initial pointer position for immediate drag
            const startX = ev.clientX
            const startY = ev.clientY

            // For group drag, store start positions of all selected elements
            const selectedElements = Array.from(getSelectedElements())
            const startPositions = selectedElements.map(s => ({
              state: s,
              x0: s.x0.value,
              y0: s.y0.value,
            }))

            // Save snapshots for all selected elements before dragging
            for (const s of selectedElements) {
              s.saveSnapshot()
            }

            function handlePointermove(moveEv: PointerEvent) {
              moveEv.preventDefault()
              // Calculate delta
              const scale = state.zoom.value
              const dx = (moveEv.clientX - startX) / scale
              const dy = (moveEv.clientY - startY) / scale

              // For single selection, apply snap to the primary element
              if (selectedElements.length === 1) {
                const rawX = startPositions[0].x0 + dx
                const rawY = startPositions[0].y0 + dy
                const snapped = state.applySnap(rawX, rawY, moveEv.metaKey)
                state.x0.value = snapped.x
                state.y0.value = snapped.y
              }
              else {
                // For multi-select, move all elements by same delta
                // Apply snap based on the clicked element, apply same offset to all
                const rawX = startPositions.find(p => p.state === state)!.x0 + dx
                const rawY = startPositions.find(p => p.state === state)!.y0 + dy
                const snapped = state.applySnap(rawX, rawY, moveEv.metaKey)
                const snapDx = snapped.x - rawX
                const snapDy = snapped.y - rawY

                for (const { state: s, x0, y0 } of startPositions) {
                  s.x0.value = x0 + dx + snapDx
                  s.y0.value = y0 + dy + snapDy
                }
              }
            }

            function handlePointerup() {
              state.clearSnapLines()
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

          // Double-click to enter crop mode (only for non-arrow elements)
          function handleDblclick(ev: MouseEvent) {
            ev.preventDefault()
            ev.stopPropagation()
            if (!state.isArrow) {
              state.enterCropMode()
            }
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
