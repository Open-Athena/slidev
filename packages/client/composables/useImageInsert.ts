import type { SlidePatch } from '@slidev/types'

export interface UploadResult {
  url: string
  path: string
  bytes: number
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const params = new URLSearchParams({ filename: file.name })
  const res = await fetch(`/__slidev/upload?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  const json = await res.json()
  if (!res.ok)
    throw new Error(json.error ?? `Upload failed (${res.status})`)
  return json as UploadResult
}

function escapeAlt(s: string): string {
  return s.replace(/[[\]]/g, '\\$&')
}

export function buildImageMarkdown(file: File, url: string): string {
  const alt = escapeAlt(file.name.replace(/\.[^.]+$/, ''))
  return file.type.startsWith('video/')
    ? `<video src="${url}" controls />`
    : `![${alt}](${url})`
}

export async function appendToSlide(no: number, snippet: string): Promise<void> {
  const slideUrl = `/__slidev/slides/${no}.json`
  const current = await fetch(slideUrl).then(r => r.json())
  const sep = current.content.endsWith('\n') ? '\n' : '\n\n'
  const patch: SlidePatch = {
    content: `${current.content}${sep}${snippet}\n`,
    skipHmr: false,
  }
  const res = await fetch(slideUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok)
    throw new Error(`Failed to patch slide ${no} (${res.status})`)
}

export async function uploadAndInsert(file: File, no: number): Promise<UploadResult> {
  const result = await uploadFile(file)
  await appendToSlide(no, buildImageMarkdown(file, result.url))
  return result
}
