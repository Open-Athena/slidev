import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!

interface SlideJson {
  content: string
}

// The `i` picker's embed tabs: a Tweet / YouTube / Bluesky URL is validated, its tag appended to
// the slide as one undoable edit, at a default position, and selected. Edits fixture slide 35
// (tracked), restored afterwards. Embeds load from the network, so the assertions are on the
// markdown, the history state and the rendered wrapper, never on third-party content.
context('insert embeds', () => {
  const NO = 35
  const url = `${BASE}/__slidev/slides/${NO}.json`
  const content = expectEventually.bind(null, url, (s: SlideJson) => s.content)
  let original = ''

  // Position of an element in the history state, as `Left,Top,Width,Height`.
  const expectPos = (id: string, pos: string) =>
    expectEventually(`${BASE}/__slidev/state`, ({ state }) => {
      const s = state[NO]?.[id]
      return s && [s.x0 - s.width / 2, s.y0 - s.height / 2, s.width, s.height].map(Math.round).join()
    }, pos)

  function visit() {
    cy.visit(`${BASE}/${NO}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
    })
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
    // The fixture's own (bound-id) video, so the cascade below counts one existing element.
    cy.get('.slidev-page-35 [data-drag-id="yt-dQw4w9WgXcQ"]').should('exist')
  }

  function openTab(tab: string) {
    // `i` toggles the picker: make sure a previous insert has closed it.
    cy.get('#slidev-insert-image-dialog').should('have.class', 'pointer-events-none')
    cy.get('body').type('i')
    cy.get('#slidev-insert-image-dialog').should('not.have.class', 'pointer-events-none')
    cy.get(`#slidev-insert-image-dialog [data-insert-tab="${tab}"]`).click()
    cy.get('#slidev-insert-image-dialog [data-insert-url]').should('have.focus')
  }

  const trimmed = (text: string) => ($e: JQuery) => expect($e.text().trim()).to.eq(text)
  const dialog = (sel: string) => cy.get(`#slidev-insert-image-dialog ${sel}`)

  // The embeds' ResizeObservers (fitting the wrapper to the widget as it loads) can trip the
  // browser's benign "loop completed with undelivered notifications" error; nothing else is ignored.
  beforeEach(() => {
    cy.on('uncaught:exception', err => !err.message.includes('ResizeObserver loop completed with undelivered notifications'))
  })

  before(() => {
    cy.request(url).then(({ body }) => original = (typeof body === 'string' ? JSON.parse(body) : body).content)
  })

  afterEach(() => {
    cy.request('POST', url, { content: original, skipHmr: false })
  })

  it('validates the URL, appends `<Youtube id>` at the default position, selects it; ⌘Z removes it', () => {
    visit()
    openTab('youtube')
    dialog('[data-insert-url]').type('https://vimeo.com/123')
    dialog('[data-insert-invalid]').should(trimmed('Not a YouTube video URL or 11-character id'))
    dialog('[data-insert-commit]').should('be.disabled')
    dialog('[data-insert-url]').clear().type('https://youtu.be/luoMHjh-XcQ?si=x')
    dialog('[data-insert-preview]').should('have.text', '<Youtube id="luoMHjh-XcQ" />')
    dialog('[data-insert-url]').type('{enter}')
    content(`${original}\n\n<Youtube id="luoMHjh-XcQ" />`)
    // Centred on the 980×552 slide ((980-480)/2, (552-274)/2), one 16 px cascade step for the fixture's video.
    expectPos('yt-luoMHjh-XcQ', '266,155,480,274')
    cy.get('.slidev-page-35 [data-drag-id="yt-luoMHjh-XcQ"]').should('exist')
    cy.get('#drag-control-container').should('exist')
    cy.get('#slidev-insert-image-dialog').should('have.class', 'pointer-events-none')
    cy.get('body').type('{cmd}z')
    content(original)
    cy.get('[data-drag-id="yt-luoMHjh-XcQ"]').should('not.exist')
  })

  it('refuses a second copy of an embed on the same slide', () => {
    visit()
    openTab('youtube')
    dialog('[data-insert-url]').type('dQw4w9WgXcQ{enter}')
    dialog('[data-insert-error]').should(trimmed('Already on slide 35 (yt-dQw4w9WgXcQ)'))
    content(original)
  })

  it('inserts a Tweet by id from its URL, and a Bluesky post by URL', () => {
    visit()
    openTab('tweet')
    dialog('[data-insert-url]').type('https://x.com/slidevjs/status/1390115482657726468?s=20{enter}')
    const tweet = '<Tweet id="1390115482657726468" />'
    content(`${original}\n\n${tweet}`)
    expectPos('tweet-1390115482657726468', '306,142,400,300')
    cy.get('.slidev-page-35 [data-drag-id="tweet-1390115482657726468"]').should('exist')
    openTab('bluesky')
    dialog('[data-insert-url]').type('https://bsky.app/profile/sli.dev{enter}')
    dialog('[data-insert-invalid]').should(trimmed('Not a bsky.app post URL or at:// post URI'))
    dialog('[data-insert-url]').clear().type('https://bsky.app/profile/sli.dev/post/3lgwg2vy44s2q{enter}')
    content(`${original}\n\n${tweet}\n\n<BlueSky uri="https://bsky.app/profile/sli.dev/post/3lgwg2vy44s2q" />`)
    cy.get('.slidev-page-35 [data-drag-id="bsky-3lgwg2vy44s2q"]').should('exist')
  })

  it('deletes an inserted embed with ⌫ (⌘Z brings it back); an embed it can\'t find shows a notice', () => {
    visit()
    openTab('youtube')
    dialog('[data-insert-url]').type('luoMHjh-XcQ{enter}')
    const inserted = `${original}\n\n<Youtube id="luoMHjh-XcQ" />`
    content(inserted)
    cy.get('#drag-control-container').should('exist')
    cy.get('body').type('{backspace}')
    content(original)
    cy.get('[data-drag-id="yt-luoMHjh-XcQ"]').should('not.exist')
    cy.get('body').type('{cmd}z')
    content(inserted)
    // Wait for the re-render, which remounts the slide's elements (a click before it is lost).
    cy.get('.slidev-page-35 [data-drag-id="yt-luoMHjh-XcQ"]').should('exist')
    // The fixture's `<Youtube :id="'…'" />`: its id is a binding, so its markup isn't found.
    // Near its top-left corner: the restored video overlaps its centre.
    cy.get('.slidev-page-35 [data-drag-id="yt-dQw4w9WgXcQ"] .youtube-fit').click(10, 10)
    cy.get('#drag-control-container').should('exist')
    cy.get('body').type('{backspace}')
    cy.get('.slidev-notice').should('be.visible').and('have.text', 'This element isn\'t deletable from the slide source')
    content(inserted)
  })
})
