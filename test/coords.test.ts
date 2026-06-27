import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyCoords,
  COORDS_FILENAME,
  getCoordsFilePath,
  loadCoords,
  saveCoordsForSlide,
} from '../packages/slidev/node/coords'

describe('coords', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'slidev-coords-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('getCoordsFilePath', () => {
    it('joins userRoot with slides.coords.yaml', () => {
      // Use `join` (not a hard-coded `/`) so the expectation matches the platform
      // separator — `getCoordsFilePath` is a filesystem path, so it's `\` on Windows.
      expect(getCoordsFilePath('/foo/bar')).toBe(join('/foo/bar', COORDS_FILENAME))
    })
  })

  describe('loadCoords', () => {
    it('returns {} when no file exists', async () => {
      expect(await loadCoords(dir)).toEqual({})
    })

    it('parses a single-slide yaml', async () => {
      writeFileSync(getCoordsFilePath(dir), '"1":\n  foo: 100,100,50,50\n')
      expect(await loadCoords(dir)).toEqual({ 1: { foo: '100,100,50,50' } })
    })

    it('parses multi-slide yaml', async () => {
      writeFileSync(
        getCoordsFilePath(dir),
        '"1":\n  foo: 1,2,3,4\n"3":\n  bar: 5,6,7,8\n  baz: 9,10,11,12\n',
      )
      expect(await loadCoords(dir)).toEqual({
        1: { foo: '1,2,3,4' },
        3: { bar: '5,6,7,8', baz: '9,10,11,12' },
      })
    })

    it('returns {} for an empty yaml file', async () => {
      writeFileSync(getCoordsFilePath(dir), '')
      expect(await loadCoords(dir)).toEqual({})
    })

    it('returns {} for a yaml that parses to a scalar', async () => {
      writeFileSync(getCoordsFilePath(dir), '"just a string"\n')
      expect(await loadCoords(dir)).toEqual({})
    })

    it('skips slide entries whose value is not an object', async () => {
      writeFileSync(
        getCoordsFilePath(dir),
        '"1":\n  foo: 1,2,3,4\n"2": "junk-value"\n"3":\n  bar: 5,6,7,8\n',
      )
      expect(await loadCoords(dir)).toEqual({
        1: { foo: '1,2,3,4' },
        3: { bar: '5,6,7,8' },
      })
    })

    it('stringifies numeric slide keys', async () => {
      // YAML can parse "1" as a number, but `Object.entries` always gives string keys.
      // The normalizer wraps with `String(k)` explicitly — confirms it.
      writeFileSync(getCoordsFilePath(dir), '1:\n  foo: 1,2,3,4\n')
      const loaded = await loadCoords(dir)
      expect(loaded['1']).toEqual({ foo: '1,2,3,4' })
    })
  })

  describe('saveCoordsForSlide', () => {
    it('creates the file when saving a slide for the first time', async () => {
      await saveCoordsForSlide(dir, 1, { foo: '100,100,50,50' })
      const content = await readFile(getCoordsFilePath(dir), 'utf-8')
      expect(content).toContain('# Slidev drag coords')
      expect(await loadCoords(dir)).toEqual({ 1: { foo: '100,100,50,50' } })
    })

    it('preserves other slides when saving one slide', async () => {
      await saveCoordsForSlide(dir, 1, { foo: '1,2,3,4' })
      await saveCoordsForSlide(dir, 3, { bar: '5,6,7,8' })
      expect(await loadCoords(dir)).toEqual({
        1: { foo: '1,2,3,4' },
        3: { bar: '5,6,7,8' },
      })
    })

    it('overwrites entries for the same slide', async () => {
      await saveCoordsForSlide(dir, 1, { foo: '1,2,3,4' })
      await saveCoordsForSlide(dir, 1, { foo: '9,9,9,9', bar: '10,10,10,10' })
      expect(await loadCoords(dir)).toEqual({
        1: { foo: '9,9,9,9', bar: '10,10,10,10' },
      })
    })

    it('drops the slide entry when given an empty dragPos map', async () => {
      await saveCoordsForSlide(dir, 1, { foo: '1,2,3,4' })
      await saveCoordsForSlide(dir, 2, { bar: '5,6,7,8' })
      await saveCoordsForSlide(dir, 1, {})
      const loaded = await loadCoords(dir)
      expect(loaded['1']).toBeUndefined()
      expect(loaded['2']).toEqual({ bar: '5,6,7,8' })
    })

    it('writes "{}" when all entries are cleared', async () => {
      await saveCoordsForSlide(dir, 1, { foo: '1,2,3,4' })
      await saveCoordsForSlide(dir, 1, {})
      const content = await readFile(getCoordsFilePath(dir), 'utf-8')
      expect(content).toContain('{}')
    })

    it('orders slides numerically in the written file (stable diffs)', async () => {
      await saveCoordsForSlide(dir, 10, { a: '1,1,1,1' })
      await saveCoordsForSlide(dir, 2, { b: '2,2,2,2' })
      await saveCoordsForSlide(dir, 1, { c: '3,3,3,3' })
      const content = await readFile(getCoordsFilePath(dir), 'utf-8')
      const i1 = content.indexOf('"1"')
      const i2 = content.indexOf('"2"')
      const i10 = content.indexOf('"10"')
      expect(i1).toBeGreaterThan(-1)
      expect(i2).toBeGreaterThan(i1)
      expect(i10).toBeGreaterThan(i2) // 10 comes after 2 numerically
    })

    it('round-trips: write → read returns equivalent', async () => {
      const input = {
        1: { foo: '1,2,3,4', bar: '5,6,7,8,30,200' },
        5: { baz: '100,100,200,150,45,150,5,4,3,2' },
      }
      await saveCoordsForSlide(dir, 1, input['1'])
      await saveCoordsForSlide(dir, 5, input['5'])
      expect(await loadCoords(dir)).toEqual(input)
    })
  })

  describe('applyCoords', () => {
    it('merges coords into existing frontmatter.dragPos', () => {
      const data: any = {
        slides: [
          { frontmatter: { dragPos: { existing: '1,1,1,1' } } },
          { frontmatter: {} },
        ],
      }
      applyCoords(data, { 1: { newone: '2,2,2,2' } })
      expect(data.slides[0].frontmatter.dragPos).toEqual({
        existing: '1,1,1,1',
        newone: '2,2,2,2',
      })
    })

    it('coords.yaml overrides inline dragPos with same id', () => {
      const data: any = {
        slides: [{ frontmatter: { dragPos: { foo: '1,1,1,1' } } }],
      }
      applyCoords(data, { 1: { foo: '9,9,9,9' } })
      expect(data.slides[0].frontmatter.dragPos.foo).toBe('9,9,9,9')
    })

    it('initializes missing frontmatter / dragPos', () => {
      const data: any = { slides: [{}] }
      applyCoords(data, { 1: { foo: '1,2,3,4' } })
      expect(data.slides[0].frontmatter.dragPos).toEqual({ foo: '1,2,3,4' })
    })

    it('does nothing for slides without coords', () => {
      const data: any = {
        slides: [
          { frontmatter: { dragPos: { foo: '1,1,1,1' } } },
          { frontmatter: { dragPos: { bar: '2,2,2,2' } } },
        ],
      }
      applyCoords(data, { 1: { foo: '9,9,9,9' } })
      expect(data.slides[1].frontmatter.dragPos).toEqual({ bar: '2,2,2,2' })
    })

    it('slide numbers are 1-based', () => {
      const data: any = { slides: [{}, {}, {}] }
      applyCoords(data, { 2: { foo: 'x' } })
      expect(data.slides[0].frontmatter).toBeUndefined()
      expect(data.slides[1].frontmatter.dragPos).toEqual({ foo: 'x' })
      expect(data.slides[2].frontmatter).toBeUndefined()
    })
  })
})
