import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!

interface SlideJson {
  content: string
}

// ⌘D / ⌘C / ⌘V duplicate selected objects. The clipboard is stubbed (the tests never touch the
// real one) and a paste is a synthetic `paste` event carrying what ⌘C wrote. Uses its own fixture
// slides (32, 33): restoring a slide right after a test's write can lose that race, and a left-over
// copy must not reach other specs' slides.
context('duplicate / copy / paste objects', () => {
  const original: Record<number, string> = {}
  const url = (no: number) => `${BASE}/__slidev/slides/${no}.json`
  const content = (no: number) => expectEventually.bind(null, url(no), (s: SlideJson) => s.content)
  let clip = ''

  const FROM = 32
  const TO = 33
  // `cp-box`'s line on slide 32, and its copy with a renamed id.
  const box = (id: string) => `<div v-drag="'${id}'" class="bg-red-500" data-testid="cp-box">copy me</div>`

  // Position of an element in the history state, as `Left,Top,Width,Height`.
  const expectPos = (no: number, id: string, pos: string) =>
    expectEventually(`${BASE}/__slidev/state`, ({ state }) => {
      const s = state[no]?.[id]
      return s && [s.x0 - s.width / 2, s.y0 - s.height / 2, s.width, s.height].map(Math.round).join()
    }, pos)

  function visit(no: number) {
    cy.visit(`${BASE}/${no}`, {
      onBeforeLoad: (win) => {
        win.localStorage.setItem('slidev-edit-mode', 'true')
        const writeText = async (t: string) => {
          clip = t
        }
        Object.defineProperty(win.navigator, 'clipboard', { value: { writeText } })
      },
    })
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
  }

  const key = (k: string) => cy.window().then(win => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, metaKey: true, bubbles: true, cancelable: true })))
  const paste = () => cy.window().then((win) => {
    const dt = new win.DataTransfer()
    dt.setData('text/plain', clip)
    win.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })

  before(() => {
    for (const no of [FROM, TO])
      cy.request(url(no)).then(({ body }) => original[no] = (typeof body === 'string' ? JSON.parse(body) : body).content)
  })

  afterEach(() => {
    for (const no of [FROM, TO])
      cy.request('POST', url(no), { content: original[no], skipHmr: false })
  })

  it('⌘D appends a copy with its own id, 16 px down-right, and selects it; ⌘Z removes it', () => {
    visit(FROM)
    cy.get('[data-testid="cp-box"]').first().click()
    key('d')
    content(FROM)(`${original[FROM]}\n\n${box('cp-box-copy')}`)
    // At cp-box's frontmatter position (100,100,100,100) + 16 px.
    expectPos(FROM, 'cp-box-copy', '116,116,100,100')
    cy.get('[data-drag-id="cp-box-copy"]').should('exist')
    cy.get('#drag-control-container').should('exist')
    cy.get('body').type('{cmd}z')
    content(FROM)(original[FROM])
  })

  it('⌘C copies the markup; ⌘V on another slide pastes it there, at the same position', () => {
    visit(FROM)
    cy.get('[data-testid="cp-box"]').click()
    key('c')
    cy.wrap(null).should(() => expect(clip).to.eq(box('cp-box')))
    // Deselect, then go to the next slide in-app (a page load would drop the copy).
    cy.get('body').type('{esc}')
    cy.get('#slide-content').click(5, 5)
    cy.get('body').type('{rightArrow}')
    cy.location('pathname').should('eq', `/${TO}`)
    paste()
    content(TO)(`${original[TO].replace(/\s+$/, '')}\n\n${box('cp-box-copy')}`)
    expectPos(TO, 'cp-box-copy', '100,100,100,100')
  })
})
