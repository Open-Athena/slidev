import { describe, expect, it } from 'vitest'
import { extractImageId } from '../packages/slidev/node/syntax/draggable-image'

describe('extractImageId', () => {
  it('strips extension and returns basename', () => {
    expect(extractImageId('mario.png')).toBe('mario')
    expect(extractImageId('cat.jpg')).toBe('cat')
    expect(extractImageId('foo.svg')).toBe('foo')
    expect(extractImageId('photo.webp')).toBe('photo')
  })

  it('takes the last path segment of a URL', () => {
    expect(extractImageId('/images/mario.png')).toBe('mario')
    expect(extractImageId('https://example.com/cat.jpg')).toBe('cat')
    expect(extractImageId('./assets/icons/heart.svg')).toBe('heart')
  })

  it('strips query string and hash before extracting basename', () => {
    expect(extractImageId('cat.jpg?v=2')).toBe('cat')
    expect(extractImageId('https://cdn.example.com/img/foo.png?cb=12345')).toBe('foo')
    expect(extractImageId('logo.png#frag')).toBe('logo')
    expect(extractImageId('logo.png?v=1#frag')).toBe('logo')
  })

  it('sanitizes non-alphanumeric characters to dashes', () => {
    expect(extractImageId('my image.png')).toBe('my-image')
    expect(extractImageId('foo bar baz.jpg')).toBe('foo-bar-baz')
    expect(extractImageId('file (1).png')).toBe('file-1')
  })

  it('collapses runs of dashes and trims leading/trailing dashes', () => {
    expect(extractImageId('--foo--bar--.png')).toBe('foo-bar')
    expect(extractImageId('  foo  .png')).toBe('foo')
  })

  it('preserves underscores and existing dashes', () => {
    expect(extractImageId('my_image.png')).toBe('my_image')
    expect(extractImageId('foo-bar-baz.png')).toBe('foo-bar-baz')
    expect(extractImageId('user_2024-q4.png')).toBe('user_2024-q4')
  })

  it('handles names without an extension', () => {
    expect(extractImageId('logo')).toBe('logo')
    expect(extractImageId('/images/sprite')).toBe('sprite')
  })

  it('falls back to "img" when the sanitized name is empty', () => {
    expect(extractImageId('')).toBe('img')
    expect(extractImageId('.png')).toBe('img')
    expect(extractImageId('---.png')).toBe('img')
    expect(extractImageId('https://example.com/')).toBe('img')
  })

  it('keeps numeric-only names', () => {
    expect(extractImageId('123.png')).toBe('123')
    expect(extractImageId('/images/0000.jpg')).toBe('0000')
  })

  it('removes only the last extension, then dashifies remaining dots', () => {
    // 'archive.tar.gz' → strip last ext → 'archive.tar' → sanitize → 'archive-tar'
    expect(extractImageId('archive.tar.gz')).toBe('archive-tar')
    // 'v1.2.3.svg' → strip last → 'v1.2.3' → sanitize → 'v1-2-3'
    expect(extractImageId('v1.2.3.svg')).toBe('v1-2-3')
  })

  it('handles relative paths with .. and .', () => {
    expect(extractImageId('../../images/logo.png')).toBe('logo')
    expect(extractImageId('./logo.png')).toBe('logo')
  })

  it('handles URLs with port and protocol', () => {
    expect(extractImageId('http://localhost:3000/foo.png')).toBe('foo')
    expect(extractImageId('https://example.com:8080/bar.jpg')).toBe('bar')
  })

  it('handles file:// URLs', () => {
    expect(extractImageId('file:///Users/foo/bar.png')).toBe('bar')
  })

  it('strips last extension even from host-only URLs', () => {
    // 'https://example.com' → basename 'example.com' → strip ext → 'example'
    expect(extractImageId('https://example.com')).toBe('example')
  })
})
