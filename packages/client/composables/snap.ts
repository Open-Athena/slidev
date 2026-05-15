// Pure snap-math helpers, factored out of `useDragElements` so they're testable
// without a Vue runtime (or the vite virtual modules the composable pulls in
// via `env`). Imported back in by `useDragElements` for the live drag/resize
// paths and by `DragControl` for the corner-handle snap.

/** Snap distance threshold, in slide-space px. Edges or centers within this distance of a target snap. */
export const SNAP_THRESHOLD = 8

export interface SnapElementInfo {
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

// Compute visible (cropped) center and dimensions for an element. Snap targets
// are derived from the visible rect — not the raw layout box — so cropped
// elements snap to *what you see*, not to invisible margins.
export function getVisibleBounds(el: SnapElementInfo) {
  const w = el.width()
  const h = el.height()
  const cT = el.cropTop()
  const cR = el.cropRight()
  const cB = el.cropBottom()
  const cL = el.cropLeft()
  const visW = w * (100 - cL - cR) / 100
  const visH = h * (100 - cT - cB) / 100
  // Crop offset in local (pre-rotation) coords. Asymmetric crops shift the
  // *visible* center away from the layout-box center.
  const offX = (cL - cR) / 100 * w / 2
  const offY = (cT - cB) / 100 * h / 2
  const rad = el.rotate() * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // Visible center in world (post-rotation) coords.
  const cx = el.x0() + offX * cos - offY * sin
  const cy = el.y0() + offX * sin + offY * cos
  return { cx, cy, w: visW, h: visH }
}

// Snap a 1D value (center coordinate of a moving rect) against a list of target
// coordinates, considering both center-to-target and edge-to-target alignment.
// `elementHalfSize` is the half-width (or half-height, for the Y axis) of the
// *visible* rect — pass 0 for resize-handle snap (where the cursor IS the edge
// being moved).
//
// Returns the snapped value plus the target line that should be drawn on screen
// (drawn at the *target* coord, not the snapped value — which differ when an
// edge snaps).
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
