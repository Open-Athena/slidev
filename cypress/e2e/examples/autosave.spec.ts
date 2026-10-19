import { parse } from 'yaml'
import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
const COORDS = 'cypress/fixtures/basic/slides.coords.yaml'
const SLIDE = 14
// `box1`'s position in the fixture's inline `dragPos`, until an edit moves it.
const INLINE = '100,100,100,100'

// One px to the right of a `Left,Top,Width,Height` position.
function rightOf(pos: string): string {
  const [l, ...rest] = pos.split(',').map(Number)
  return [l + 1, ...rest].join()
}

// Saving writes the history's element positions to `slides.coords.yaml`: automatically shortly
// after each edit (autosave, on by default; the support file turns it off for other specs), or on
// ⌘S. ⌘⇧S toggles autosave.
context('autosave', () => {
  function visit(autosave: boolean) {
    cy.visit(`${BASE}/${SLIDE}`, {
      onBeforeLoad: (win) => {
        win.localStorage.setItem('slidev-edit-mode', 'true')
        win.localStorage.setItem('slidev-autosave', String(autosave))
      },
    })
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
    cy.get('[data-testid="box1"]').click()
    cy.get('#drag-control-container').should('have.attr', 'data-drag-id', 'box1')
  }

  const nudge = (key: 'Right' | 'Left') => cy.get('body').trigger('keydown', { key: `Arrow${key}` })

  const posOf = (s?: { x0: number, y0: number, width: number, height: number }) =>
    s && [s.x0 - s.width / 2, s.y0 - s.height / 2, s.width, s.height].map(Math.round).join()

  // `box1`'s position in the history's element state (the edit has reached the server).
  const expectState = (pos: string) => expectEventually(`${BASE}/__slidev/state`, ({ state }) => posOf(state[SLIDE]?.box1), pos)

  // Where `box1` is now: a retried attempt starts wherever the last one left it.
  const start = (): Cypress.Chainable<string> =>
    cy.request(`${BASE}/__slidev/state`).then(({ body }) => posOf(body.state[SLIDE]?.box1) ?? INLINE)

  // `box1`'s position in `slides.coords.yaml`.
  const expectSaved = (pos: string) => cy.readFile(COORDS).should((text: string) => {
    expect(parse(text)[String(SLIDE)].box1).to.eq(pos)
  })

  afterEach(() => {
    cy.task('removeFile', COORDS)
  })

  it('on: each edit is saved shortly after it', () => {
    visit(true)
    start().then((from) => {
      nudge('Right')
      expectSaved(rightOf(from))
      nudge('Left')
      expectSaved(from)
    })
  })

  it('off: nothing is saved until ⌘S', () => {
    visit(false)
    start().then((from) => {
      nudge('Right')
      expectState(rightOf(from))
      cy.wait(1500)
      cy.readFile(COORDS).should('not.exist')
      cy.get('body').type('{cmd}s')
      expectSaved(rightOf(from))
      nudge('Left')
      expectState(from)
      cy.get('body').type('{cmd}s')
      expectSaved(from)
    })
  })

  it('⌘⇧S toggles it', () => {
    visit(true)
    cy.get('body').type('{cmd}{shift}s')
    cy.get('.slidev-notice').should('have.text', 'Autosave off: ⌘S saves')
    cy.window().then(win => expect(win.localStorage.getItem('slidev-autosave')).to.eq('false'))
    // ⇧S (skip skipped slides) didn't fire too: still its default.
    cy.window().then(win => expect(win.localStorage.getItem('slidev-skip-skipped')).to.eq('true'))
    cy.get('body').type('{cmd}{shift}s')
    cy.get('.slidev-notice').should('have.text', 'Autosave on')
  })
})
