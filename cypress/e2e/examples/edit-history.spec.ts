import { expectEventually } from '../../poll'

const BASE = 'http://localhost:3041'
const NUDGE_SLIDE = 14
const OTHER_SLIDE = 15
const CLAMP_SLIDE = 28

interface Snapshot {
  x0: number
  y0: number
  width: number
  height: number
}

// The position as written to `slides.coords.yaml` (`Left,Top,Width,Height`, rounded).
function posStr(s: Snapshot): string {
  return [s.x0 - s.width / 2, s.y0 - s.height / 2, s.width, s.height].map(Math.round).join()
}

function shift(pos: string, dx: number, dy: number): string {
  const [l, t, w, h] = pos.split(',').map(Number)
  return [l + dx, t + dy, w, h].join()
}

// Edit-mode history: arrow nudges are discrete and reversible, each is undoable, ⌘Z never
// changes slides unannounced, and resizing a flow-layout image never widens its grid column.
context('edit-mode history', () => {
  function visit(no: number) {
    cy.visit(`${BASE}/${no}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
    })
    // Generous timeout: the first visit after the fixture server starts compiles the deck.
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
  }

  // Poll the server's element state (edits commit after a short debounce).
  function expectPos(slide: number, dragId: string, expected: string) {
    expectEventually(`${BASE}/__slidev/state`, ({ state }) => state[slide]?.[dragId] && posStr(state[slide][dragId]), expected)
  }

  // One arrow-key press, as a plain `keydown` (`cy.type('{shift}…')` doesn't reliably carry Shift).
  function nudge(keys: string, shift = false) {
    for (const k of keys.split(' '))
      cy.get('body').trigger('keydown', { key: `Arrow${k}`, shiftKey: shift })
  }

  // Select `box1` and nudge it once, so it has a recorded position to compare against.
  function selectAndSettle(): Cypress.Chainable<string> {
    visit(NUDGE_SLIDE)
    cy.get('[data-testid="box1"]').click()
    cy.get('#drag-control-container').should('exist')
    nudge('Right')
    expectEventually(`${BASE}/__slidev/state`, ({ state }) => state[NUDGE_SLIDE]?.box1 !== undefined, true)
    // Let the nudge's history entry commit, so later nudges are separate entries.
    cy.wait(400)
    return cy.request(`${BASE}/__slidev/state`).then(({ body }) => posStr(body.state[NUDGE_SLIDE].box1))
  }

  it('nudges by exact steps, and opposite nudges restore the position exactly', () => {
    selectAndSettle().then((start) => {
      nudge('Right Right Down')
      expectPos(NUDGE_SLIDE, 'box1', shift(start, 2, 1))
      nudge('Right Down', true)
      expectPos(NUDGE_SLIDE, 'box1', shift(start, 12, 11))
      nudge('Left Up', true)
      nudge('Left Left Up')
      expectPos(NUDGE_SLIDE, 'box1', start)
    })
    // Shift+Arrow nudged; it didn't change slides.
    cy.location('pathname').should('eq', `/${NUDGE_SLIDE}`)
  })

  it('⌘Z undoes a nudge without changing slides', () => {
    selectAndSettle().then((start) => {
      nudge('Right', true)
      expectPos(NUDGE_SLIDE, 'box1', shift(start, 10, 0))
      cy.get('body').type('{cmd}z')
      expectPos(NUDGE_SLIDE, 'box1', start)
    })
    cy.location('pathname').should('eq', `/${NUDGE_SLIDE}`)
  })

  it('⌘Z for an edit on another slide first says where it is, and goes there on a second press', () => {
    selectAndSettle().then((start) => {
      nudge('Down', true)
      expectPos(NUDGE_SLIDE, 'box1', shift(start, 0, 10))
      visit(OTHER_SLIDE)
      cy.get('body').type('{cmd}z')
      cy.get('.slidev-notice').should('be.visible').and('contain.text', `is on slide ${NUDGE_SLIDE}`)
      cy.location('pathname').should('eq', `/${OTHER_SLIDE}`)
      expectPos(NUDGE_SLIDE, 'box1', shift(start, 0, 10))
      cy.get('body').type('{cmd}z')
      cy.location('pathname').should('eq', `/${NUDGE_SLIDE}`)
      expectPos(NUDGE_SLIDE, 'box1', start)
    })
  })

  it('resizing a flow-layout image past its grid column clamps it, leaving the other column alone', () => {
    visit(CLAMP_SLIDE)
    cy.get('[data-testid="clamp-img"]').should($img => expect(($img[0] as HTMLImageElement).complete).to.eq(true))
    cy.get('[data-testid="clamp-img"]').click()
    // The bottom-right handle (of the two `nwse-resize` corners, the one furthest down-right),
    // re-queried for each event since the controls re-render as the element resizes.
    const bottomRight = () => cy.get('#drag-control-container div[style*="nwse-resize"]').then($hs =>
      Cypress.$($hs.toArray().reduce((a, b) => {
        const [ra, rb] = [a.getBoundingClientRect(), b.getBoundingClientRect()]
        return rb.left + rb.top > ra.left + ra.top ? b : a
      })))
    bottomRight().then(($h) => {
      const r = $h[0].getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const at = (dx: number, dy: number) => ({ button: 0, buttons: 1, pointerId: 1, clientX: x + dx, clientY: y + dy, metaKey: true, force: true })
      bottomRight().trigger('pointerdown', at(0, 0))
      bottomRight().trigger('pointermove', at(300, 60))
      bottomRight().trigger('pointermove', at(600, 100))
      bottomRight().trigger('pointerup', at(600, 100))
    })
    // Both columns keep their equal share of the grid, and the image fills (only) its own.
    cy.get('[data-testid="clamp-grid"]').should(($g) => {
      const grid = $g[0]
      const scale = grid.getBoundingClientRect().width / grid.offsetWidth
      const half = (grid.offsetWidth - Number.parseFloat(getComputedStyle(grid).columnGap)) / 2 * scale
      const width = (sel: string) => Cypress.$(sel)[0].getBoundingClientRect().width
      expect([width('[data-testid="clamp-left"]'), width('[data-testid="clamp-img"]')].map(w => Math.round(w))).to.deep.eq([Math.round(half), Math.round(half)])
    })
  })
})
