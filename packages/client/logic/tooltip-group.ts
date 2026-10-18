// Toolbar tooltips share a delay group: the first opens after a short delay, and moving on to
// another control soon after opens its tooltip at once. (Module state, so it's shared by every
// `IconButton`.)
const SHOW_DELAY_MS = 150
const GROUP_MS = 400
let lastHiddenAt = 0

export function tooltipShowDelay(): number {
  return Date.now() - lastHiddenAt < GROUP_MS ? 0 : SHOW_DELAY_MS
}

export function tooltipHidden(): void {
  lastHiddenAt = Date.now()
}
