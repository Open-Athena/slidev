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

export function escapeAlt(s: string): string {
  return s.replace(/[[\]]/g, '\\$&')
}

export function buildImageMarkdown(file: File, url: string): string {
  const alt = escapeAlt(file.name.replace(/\.[^.]+$/, ''))
  return file.type.startsWith('video/')
    ? `<video src="${url}" controls />`
    : `![${alt}](${url})`
}

// Append the snippet(s) to the end of the slide as one undoable history event, left where the
// layout puts them. Imported lazily: the history plumbing pulls in the app's virtual modules, which
// the pure helpers above (tested in `test/image-insert.test.ts`) shouldn't need.
export async function appendToSlide(no: number, snippets: string | string[]): Promise<void> {
  const { insertElements } = await import('./useInsertElements')
  await insertElements(no, [snippets].flat().map(snippet => ({ snippet, dragId: null, pos: null })))
}

/** Upload the files, then insert them into slide `no` together (one ⌘Z removes them all). */
export async function uploadAndInsert(files: File | File[], no: number): Promise<UploadResult[]> {
  const list = [files].flat()
  const results: UploadResult[] = []
  for (const file of list)
    results.push(await uploadFile(file))
  await appendToSlide(no, list.map((file, i) => buildImageMarkdown(file, results[i].url)))
  return results
}
