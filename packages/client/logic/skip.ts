import type { SlideRoute } from '@slidev/types'

// Slides marked `skip: true` stay in the deck (numbers and URLs don't change); while "skip skipped
// slides" is on, next / previous step over them. Going to one directly (`g`, a URL) still works.

export function isSkippedRoute(route?: SlideRoute): boolean {
  return route?.meta?.slide?.frontmatter?.skip === true
}

/**
 * The next slide number after `from` (`dir` 1) or before it (`dir` -1), stepping over skipped
 * slides when `skipping`; `undefined` past the deck's end.
 */
export function neighborSlideNo(routes: SlideRoute[], from: number, dir: 1 | -1, skipping: boolean): number | undefined {
  for (let no = from + dir; no >= 1 && no <= routes.length; no += dir) {
    if (!skipping || !isSkippedRoute(routes[no - 1]))
      return no
  }
  return undefined
}
