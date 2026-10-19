import type { WorkerSlide } from '../packages/slidev/node/worker/runtime'
import { describe, expect, it } from 'vitest'
import { recordSlugChanges, slugAliases } from '../packages/slidev/node/slug-history'
import { matchSlide, slideRedirect } from '../packages/slidev/node/worker/runtime'

const T1 = '2026-10-19T10:00:00.000Z'
const T2 = '2026-10-19T11:00:00.000Z'
const T3 = '2026-10-19T12:00:00.000Z'

describe('recording slug changes', () => {
  it('a renamed slide keeps its old slug', () => {
    expect(recordSlugChanges({}, [{ from: 'setup', to: 'install' }], T1)).toEqual({ install: { setup: T1 } })
  })

  it('its earlier old slugs follow it through further renames', () => {
    const once = recordSlugChanges({}, [{ from: 'a', to: 'b' }], T1)
    expect(recordSlugChanges(once, [{ from: 'b', to: 'c' }], T2)).toEqual({ c: { a: T1, b: T2 } })
  })

  it('going back to an old slug drops it from the history', () => {
    const once = recordSlugChanges({}, [{ from: 'a', to: 'b' }], T1)
    expect(recordSlugChanges(once, [{ from: 'b', to: 'a' }], T2)).toEqual({ a: { b: T2 } })
  })

  it('two slides swapping slugs each keep their own history', () => {
    const history = { x: { old: T1 } }
    expect(recordSlugChanges(history, [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }], T2)).toEqual({
      y: { old: T1, x: T2 },
      x: { y: T2 },
    })
  })
})

describe('which slide an old slug leads to', () => {
  it('the one that had it most recently; newest old slugs first', () => {
    const history = {
      install: { setup: T1, intro: T3 },
      overview: { intro: T2, start: T2 },
    }
    expect(slugAliases(history, ['install', 'overview'])).toEqual({
      install: ['intro', 'setup'],
      overview: ['start'],
    })
  })

  it('never a slug some slide has now, and not for slides that are gone', () => {
    const history = {
      install: { overview: T1, setup: T1 },
      removed: { other: T2 },
    }
    expect(slugAliases(history, ['install', 'overview'])).toEqual({ install: ['setup'] })
  })
})

describe('the Worker resolves `/<n>-<slug>` by slug, and redirects to the current URL', () => {
  const slide = (no: number, slug: string, extra: Partial<WorkerSlide> = {}): WorkerSlide => ({
    no,
    slug,
    title: slug,
    description: '',
    path: `/${no}-${slug}`,
    image: `/_og/${no}-${slug}.jpg`,
    hash: 'h',
    bareSlug: true,
    ...extra,
  })
  // Slide 6 used to be slide 7 (a slide before it was removed), and was called `setup`.
  const slides = [slide(5, 'intro'), slide(6, 'install', { aliases: ['setup'], bareAliases: ['setup'] }), slide(7, 'faq')]
  const resolve = (rel: string) => {
    const s = matchSlide(slides, rel)
    return s && { no: s.no, redirect: slideRedirect(s, rel, '/') ?? null }
  }

  it('by slug, wherever the slide is now', () => {
    expect([resolve('7-install'), resolve('6-install'), resolve('7-setup'), resolve('setup')]).toEqual([
      { no: 6, redirect: '/6-install' },
      { no: 6, redirect: null },
      { no: 6, redirect: '/6-install' },
      { no: 6, redirect: '/6-install' },
    ])
  })

  it('by number when no slide has the slug, or for a plain number; a bare slug stays', () => {
    expect([resolve('7-unknown'), resolve('7'), resolve('install')]).toEqual([
      { no: 7, redirect: '/7-faq' },
      { no: 7, redirect: null },
      { no: 6, redirect: null },
    ])
  })
})
