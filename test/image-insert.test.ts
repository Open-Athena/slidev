import { describe, expect, it } from 'vitest'
import { buildImageMarkdown, escapeAlt } from '../packages/client/composables/useImageInsert'

function mockFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

describe('escapeAlt', () => {
  it('escapes square brackets', () => {
    expect(escapeAlt('foo')).toBe('foo')
    expect(escapeAlt('[hello]')).toBe('\\[hello\\]')
    expect(escapeAlt('a [b] c')).toBe('a \\[b\\] c')
  })

  it('leaves other characters alone', () => {
    expect(escapeAlt('a-b_c.d (e)')).toBe('a-b_c.d (e)')
  })

  it('handles empty input', () => {
    expect(escapeAlt('')).toBe('')
  })
})

describe('buildImageMarkdown', () => {
  it('emits markdown image syntax for image files', () => {
    expect(buildImageMarkdown(mockFile('logo.png'), '/uploads/logo.png'))
      .toBe('![logo](/uploads/logo.png)')
    expect(buildImageMarkdown(mockFile('Photo.JPG', 'image/jpeg'), '/u/Photo.JPG'))
      .toBe('![Photo](/u/Photo.JPG)')
  })

  it('emits <video> HTML for video files', () => {
    expect(buildImageMarkdown(mockFile('clip.mp4', 'video/mp4'), '/uploads/clip.mp4'))
      .toBe('<video src="/uploads/clip.mp4" controls />')
  })

  it('strips the file extension from the alt text', () => {
    expect(buildImageMarkdown(mockFile('foo.bar.png'), '/url'))
      .toBe('![foo.bar](/url)')
  })

  it('escapes brackets in alt text', () => {
    expect(buildImageMarkdown(mockFile('logo[1].png'), '/u/logo'))
      .toBe('![logo\\[1\\]](/u/logo)')
  })

  it('handles files without an extension', () => {
    expect(buildImageMarkdown(mockFile('logo'), '/u/logo'))
      .toBe('![logo](/u/logo)')
  })

  it('uses image markdown for unknown MIME (treats as image since no video/ prefix)', () => {
    expect(buildImageMarkdown(mockFile('foo.svg', ''), '/u/foo.svg'))
      .toBe('![foo](/u/foo.svg)')
  })
})
