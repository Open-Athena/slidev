import { expectEventually } from '../../poll'

const BASE = 'http://localhost:3041'

interface SlideJson {
  content: string
}

// ⌘D / ⌘C / ⌘V duplicate selected objects. The clipboard is stubbed (the tests never touch the
// real one) and a paste is a synthetic `paste` event carrying what ⌘C wrote. Edits fixture
// slides 14 and 15 (tracked), restored afterwards.
context('duplicate / copy / paste objects', () => {
  const original: Record<number, string> = {}
  const url = (no: number) => `${BASE}/__slidev/slides/${no}.json`
  const content = (no: number) => expectEventually.bind(null, url(no), (s: SlideJson) => s.content)
  let clip = ''

  // `box1`'s line on slide 14, and its copy with a renamed id.
  const box = (id: string, testid = 'box1') => `<div v-drag="'${id}'" class="cy-drag-box bg-red-500" data-testid="${testid}">100x100</div>`

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
    for (const no of [14, 15])
      cy.request(url(no)).then(({ body }) => original[no] = (typeof body === 'string' ? JSON.parse(body) : body).content)
  })

  afterEach(() => {
    for (const no of [14, 15])
      cy.request('POST', url(no), { content: original[no], skipHmr: false })
  })

  it('⌘D appends a copy with its own id, 16 px down-right, and selects it; ⌘Z removes it', () => {
    visit(14)
    cy.get('[data-testid="box1"]').first().click()
    key('d')
    content(14)(`${original[14]}\n\n${box('box1-copy')}`)
    // At box1's frontmatter position (100,100,100,100) + 16 px.
    expectPos(14, 'box1-copy', '116,116,100,100')
    cy.get('[data-drag-id="box1-copy"]').should('exist')
    cy.get('#drag-control-container').should('exist')
    cy.get('body').type('{cmd}z')
    content(14)(original[14])
  })

  it('⌘C copies the markup; ⌘V on another slide pastes it there, at the same position', () => {
    visit(14)
    cy.get('[data-testid="box1"]').click()
    key('c')
    cy.wrap(null).should(() => expect(clip).to.eq(box('box1')))
    // Deselect, then go to the next slide in-app (a page load would drop the copy).
    cy.get('body').type('{esc}')
    cy.get('#slide-content').click(5, 5)
    cy.get('body').type('{rightArrow}')
    cy.location('pathname').should('eq', '/15')
    paste()
    content(15)(`${original[15].replace(/\s+$/, '')}\n\n${box('box1-copy')}`)
    expectPos(15, 'box1-copy', '100,100,100,100')
  })
})
