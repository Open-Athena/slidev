import type { SlideRoute } from '@slidev/types'
import { describe, expect, it } from 'vitest'
import { isSkippedRoute, neighborSlideNo } from '../packages/client/logic/skip'
import { rangeWithoutSkipped } from '../packages/slidev/node/commands/export'

// Slides 2 and 4 of 5 are skipped.
const skipped = new Set([2, 4])
const routes = [1, 2, 3, 4, 5].map(no => ({ no, meta: { slide: { frontmatter: skipped.has(no) ? { skip: true } : {} } } }) as unknown as SlideRoute)
const slides = routes.map(r => ({ frontmatter: r.meta.slide!.frontmatter }))

describe('stepping over skipped slides', () => {
  it('`skip: true` (only) marks a slide skipped', () => {
    expect(routes.map(isSkippedRoute)).toEqual([false, true, false, true, false])
    expect(isSkippedRoute({ no: 9, meta: { slide: { frontmatter: { skip: 'yes' } } } } as unknown as SlideRoute)).toBe(false)
    expect(isSkippedRoute(undefined)).toBe(false)
  })

  it('next / previous, skipping', () => {
    expect([1, 2, 3, 4, 5].map(no => neighborSlideNo(routes, no, 1, true))).toEqual([3, 3, 5, 5, undefined])
    expect([1, 2, 3, 4, 5].map(no => neighborSlideNo(routes, no, -1, true))).toEqual([undefined, 1, 1, 3, 3])
  })

  it('next / previous, not skipping', () => {
    expect([1, 2, 3, 4, 5].map(no => neighborSlideNo(routes, no, 1, false))).toEqual([2, 3, 4, 5, undefined])
    expect([1, 2, 3, 4, 5].map(no => neighborSlideNo(routes, no, -1, false))).toEqual([undefined, 1, 2, 3, 4])
  })

  it('a deck ending in skipped slides has no next past the last kept one', () => {
    const tail = [1, 2, 3].map(no => ({ no, meta: { slide: { frontmatter: no > 1 ? { skip: true } : {} } } }) as unknown as SlideRoute)
    expect(neighborSlideNo(tail, 1, 1, true)).toBe(undefined)
  })
})

describe('export leaves skipped slides out', () => {
  it('of the whole deck', () => {
    expect(rangeWithoutSkipped(slides)).toBe('1,3,5')
  })

  it('of a range', () => {
    expect(rangeWithoutSkipped(slides, '2-4')).toBe('3')
  })

  it('a range with nothing skipped stays as given', () => {
    expect(rangeWithoutSkipped(slides, '1,3')).toBe('1,3')
    expect(rangeWithoutSkipped(slides.map(() => ({ frontmatter: {} })))).toBe(undefined)
  })

  it('a range of only skipped slides is an error', () => {
    expect(() => rangeWithoutSkipped(slides, '2,4')).toThrow('Every slide to export is marked `skip: true`; pass --with-skipped to export them')
  })
})
