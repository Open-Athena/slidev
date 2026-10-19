import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
const SOURCE = 'cypress/fixtures/basic/slides.md'
// The image-fit collage slide (see `image-fit.spec.ts`); its `fit-fill` image gets moved here.
const SLIDE = 34
const HEADING = `# Page ${SLIDE}`

// Element state is keyed by slide number. Editing `slides.md` to insert, remove or move slides
// must carry it along with its slide. The tests rewrite the fixture deck's (tracked) markdown, and
// put it back afterwards.
context('slide state follows its slide when the markdown changes', () => {
  let original = ''
  // `fit-fill`'s inline `left` after the last move.
  let movedLeft = ''

  // The slide numbers holding a position for `fit-fill`.
  const slidesWithFill = (body: { state: Record<string, Record<string, unknown>> }) =>
    Object.keys(body.state).filter(no => body.state[no]['fit-fill'] != null)

  function moveFill() {
    cy.visit(`${BASE}/${SLIDE}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
    }).wait(500)
    cy.get('#slide-content').should($slide => expect($slide[0].getBoundingClientRect().width).to.be.greaterThan(100))
    cy.get('[data-testid="fit-fill"]').click()
    cy.get('#drag-control-container').should('have.attr', 'data-drag-id', 'fit-fill')
    cy.get('body').type('{shift}{rightArrow}')
    cy.get('[data-testid="fit-fill"]').then(($img) => {
      movedLeft = $img[0].style.left
      // Wait for the move to be saved (the collage sits at x = 60 on the slide).
      expectEventually(`${BASE}/__slidev/state`, (body: { state: Record<string, Record<string, { x0: number, width: number }>> }) => {
        const fill = body.state[String(SLIDE)]?.['fit-fill']
        return fill && `${Math.round(fill.x0 - fill.width / 2) - 60}px`
      }, movedLeft)
    })
  }

  function expectFillMovedOn(no: number) {
    cy.visit(`${BASE}/${no}`).wait(500)
    cy.get('[data-testid="fit-fill"]').should($img => expect($img[0].style.left).to.eq(movedLeft))
  }

  before(() => {
    cy.readFile(SOURCE).then((text: string) => {
      original = text
    })
  })

  afterEach(() => {
    cy.writeFile(SOURCE, original)
  })

  it('shifts past a slide inserted before it, and back when that slide is removed', () => {
    moveFill()
    // Authored at `left: 62%` of the 800px collage = 496px; nudged 10px right.
    cy.then(() => expect(movedLeft).to.eq('506px'))
    cy.then(() => cy.writeFile(SOURCE, original.replace(`\n---\n\n${HEADING}\n`, `\n---\n\n# Inserted\n\n---\n\n${HEADING}\n`)))
    expectEventually(`${BASE}/__slidev/state`, slidesWithFill, [String(SLIDE + 1)])
    expectFillMovedOn(SLIDE + 1)

    cy.then(() => cy.writeFile(SOURCE, original))
    expectEventually(`${BASE}/__slidev/state`, slidesWithFill, [String(SLIDE)])
    expectFillMovedOn(SLIDE)
  })

  it('parks a removed slide\'s positions, and restores them when the slide comes back', () => {
    moveFill()
    const at = original.indexOf(`\n---\n\n${HEADING}\n`)
    const next = original.indexOf('\n---\n', at + 1)
    const without = original.slice(0, at) + (next === -1 ? '\n' : original.slice(next))
    cy.then(() => cy.writeFile(SOURCE, without))
    expectEventually(`${BASE}/__slidev/state`, slidesWithFill, [])

    cy.then(() => cy.writeFile(SOURCE, original))
    expectEventually(`${BASE}/__slidev/state`, slidesWithFill, [String(SLIDE)])
    expectFillMovedOn(SLIDE)
  })
})
