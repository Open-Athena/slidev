import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isPublicAsset } from '../packages/slidev/node/vite/importGuard'

// `isPublicAsset` decides whether a root-absolute slide import (`/foo.svg`) should be
// exempted from the fs.allow guard because it maps to a real file under Vite's `publicDir`.
// This is the path that lets `<img src="/feature.svg">` (a public asset) keep working
// after upstream's slide-import guard landed.
describe('isPublicAsset', () => {
  const publicDir = mkdtempSync(path.join(tmpdir(), 'slidev-public-'))
  mkdirSync(path.join(publicDir, 'nested'), { recursive: true })
  writeFileSync(path.join(publicDir, 'feature.svg'), '<svg/>')
  writeFileSync(path.join(publicDir, 'nested', 'icon.png'), 'x')
  writeFileSync(path.join(publicDir, 'with space.svg'), '<svg/>')

  afterAll(() => {
    // best-effort cleanup; tmpdir entries are reaped by the OS regardless
  })

  it('accepts a root-absolute path to an existing public file', () => {
    expect(isPublicAsset('/feature.svg', publicDir)).toBe(true)
    expect(isPublicAsset('/nested/icon.png', publicDir)).toBe(true)
  })

  it('strips query/hash before resolving, and decodes percent-encoding', () => {
    expect(isPublicAsset('/feature.svg?v=2', publicDir)).toBe(true)
    expect(isPublicAsset('/feature.svg#frag', publicDir)).toBe(true)
    expect(isPublicAsset('/with%20space.svg', publicDir)).toBe(true)
  })

  it('rejects paths with no matching public file', () => {
    expect(isPublicAsset('/missing.svg', publicDir)).toBe(false)
    expect(isPublicAsset('/nested/missing.png', publicDir)).toBe(false)
  })

  it('rejects non-public-asset shapes', () => {
    expect(isPublicAsset('feature.svg', publicDir)).toBe(false) // bare/relative, not root-absolute
    expect(isPublicAsset('./feature.svg', publicDir)).toBe(false)
    expect(isPublicAsset('/@fs/feature.svg', publicDir)).toBe(false) // vite internal
    expect(isPublicAsset('/@id/feature.svg', publicDir)).toBe(false)
    expect(isPublicAsset('/', publicDir)).toBe(false) // empty relative
  })

  it('rejects everything when publicDir is disabled', () => {
    expect(isPublicAsset('/feature.svg', false)).toBe(false)
    expect(isPublicAsset('/feature.svg', undefined)).toBe(false)
  })
})
