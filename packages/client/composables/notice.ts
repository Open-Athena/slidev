// A transient notice at the bottom of the window (e.g. "the latest edit is on slide 7"), for
// dev / edit-mode feedback that shouldn't need a modal.

let el: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined

export function showNotice(text: string, ms = 3500): void {
  if (typeof document === 'undefined')
    return
  if (!el) {
    el = document.createElement('div')
    el.className = 'slidev-notice'
    el.setAttribute('role', 'status')
    document.body.appendChild(el)
  }
  el.textContent = text
  el.hidden = false
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (el)
      el.hidden = true
  }, ms)
}
