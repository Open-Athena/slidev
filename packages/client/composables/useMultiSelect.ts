import type { DragElementState } from './useDragElements'
import { computed, shallowRef, triggerRef } from 'vue'

// Set-based selection for multi-select support
// Using shallowRef + triggerRef pattern for reactive Set
const selectedDragElements = shallowRef<Set<DragElementState>>(new Set())

export function selectElement(state: DragElementState): void {
  selectedDragElements.value.clear()
  selectedDragElements.value.add(state)
  triggerRef(selectedDragElements)
}

export function addToSelection(state: DragElementState): void {
  selectedDragElements.value.add(state)
  triggerRef(selectedDragElements)
}

export function removeFromSelection(state: DragElementState): void {
  selectedDragElements.value.delete(state)
  triggerRef(selectedDragElements)
}

export function toggleSelection(state: DragElementState): void {
  if (selectedDragElements.value.has(state)) {
    selectedDragElements.value.delete(state)
  }
  else {
    selectedDragElements.value.add(state)
  }
  triggerRef(selectedDragElements)
}

export function clearSelection(): void {
  // Exit crop mode on all selected elements before clearing
  for (const state of selectedDragElements.value) {
    if (state.isCropping.value) {
      state.exitCropMode()
    }
  }
  selectedDragElements.value.clear()
  triggerRef(selectedDragElements)
}

export function isSelected(state: DragElementState): boolean {
  return selectedDragElements.value.has(state)
}

export function getSelectedElements(): Set<DragElementState> {
  return selectedDragElements.value
}

export const getSingleSelected = computed((): DragElementState | null => {
  if (selectedDragElements.value.size === 1) {
    return selectedDragElements.value.values().next().value ?? null
  }
  return null
})

export const hasMultipleSelected = computed((): boolean => {
  return selectedDragElements.value.size > 1
})

export const hasSelection = computed((): boolean => {
  return selectedDragElements.value.size > 0
})

export const selectionCount = computed((): number => {
  return selectedDragElements.value.size
})

// Re-export for backwards compatibility with activeDragElement pattern
// This allows gradual migration
export { selectedDragElements }
