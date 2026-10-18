import { describe, expect, it } from 'vitest'
import { resolveNumberedSlug } from '../packages/client/logic/slidePath'

describe('resolveNumberedSlug', () => {
  const slides = [
    { no: 1, slug: 'intro' },
    { no: 2, slug: 'new-slide' },
    { no: 3, slug: 'install' },
    { no: 4, slug: 'demo' },
    { no: 5, slug: 'demo' },
  ]
  const slugOf = (s: { slug: string }) => s.slug

  it('follows a slug to where its slide is now, else falls back to the number', () => {
    expect([
      // `/2-install`, shared before `new-slide` was inserted at 2.
      resolveNumberedSlug(2, 'install', slides, slugOf),
      resolveNumberedSlug(3, 'install', slides, slugOf),
      // Renamed slug: no slide has it.
      resolveNumberedSlug(3, 'setup', slides, slugOf),
      // Ambiguous slug: two slides have it.
      resolveNumberedSlug(4, 'demo', slides, slugOf),
    ]).toEqual([3, 3, 3, 4])
  })
})
