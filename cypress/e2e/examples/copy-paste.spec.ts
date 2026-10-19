import { expectEventually } from '../../poll'

const BASE = 'http://localhost:3041'
const SLIDE = 14

interface SlideJson {
  content: string
  frontmatter: { dragPos?: Record<string, string> }
}

// ⌘C / ⌘V duplicates a selected element. The clipboard is stubbed (the test never touches the
// real one) and the paste is a synthetic `paste` event carrying what ⌘C wrote. Edits fixture
// slide 14 (tracked), restored afterwards.
context('copy / paste elements', () => {
  let original: SlideJson
  const url = `${BASE}/__slidev/slides/${SLIDE}.json`

  before(() => {
    cy.request(url).then(({ body }) => original = typeof body === 'string' ? JSON.parse(body) : body)
  })

  afterEach(() => {
    cy.request('POST', url, { content: original.content, skipHmr: false })
  })

  it('⌘C / ⌘V appends a copy with its own id, 20 px down-right; ⌘Z removes it', () => {
    let clip = ''
    cy.visit(`${BASE}/${SLIDE}`, {
      onBeforeLoad: (win) => {
        win.localStorage.setItem('slidev-edit-mode', 'true')
        const writeText = async (t: string) => {
          clip = t
        }
        Object.defineProperty(win.navigator, 'clipboard', { value: { writeText } })
      },
    })
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
    cy.get('[data-testid="box1"]').click()
    cy.get('#drag-control-container').should('exist')
    cy.window().then(win => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true })))
    cy.wrap(null).should(() => expect(clip).to.eq(`<div v-drag="'box1'" class="cy-drag-box bg-red-500" data-testid="box1">100x100</div>`))
    cy.window().then((win) => {
      const dt = new win.DataTransfer()
      dt.setData('text/plain', clip)
      win.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    const copy = `<div v-drag="'box1-copy'" class="cy-drag-box bg-red-500" data-testid="box1">100x100</div>`
    expectEventually(url, (s: SlideJson) => s.content, `${original.content}\n\n${copy}`)
    // Positioned in the history state, at box1's frontmatter position (100,100,100,100) + 20 px.
    expectEventually(`${BASE}/__slidev/state`, ({ state }) => {
      const s = state[SLIDE]?.['box1-copy']
      return s && [s.x0 - s.width / 2, s.y0 - s.height / 2, s.width, s.height].map(Math.round).join()
    }, '120,120,100,100')
    cy.get('body').type('{cmd}z')
    expectEventually(url, (s: SlideJson) => s.content, original.content)
  })
})
