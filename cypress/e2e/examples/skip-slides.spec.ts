const BASE = Cypress.config('baseUrl')!
const SOURCE = 'cypress/fixtures/basic/slides.md'

// Fixture slides 36-40: 37 and 39 are `skip: true`; 38 has frontmatter (`class: skip-target`),
// so marking it skipped adds one line.
const waitForSlide = () => cy.get('#slide-content').should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
const heading = () => cy.get('#slide-content .slidev-page h1:visible')
// The counter's parts (badge, number, total), as they read; retried until they match.
function expectCounter(text: string) {
  cy.get('[data-testid="slide-counter"]').should(($c) => {
    expect($c.children().toArray().map(c => c.textContent!.replace(/\s+/g, ' ').trim()).join(' ')).to.eq(text)
  })
}

context('skipped slides', () => {
  it('next / previous step over skipped slides; ⇧S shows them again', () => {
    cy.visit(`${BASE}/36`)
    waitForSlide()
    expectCounter('36 / 40 · 2 skipped')

    cy.get('body').type('{rightArrow}')
    cy.location('pathname').should('eq', '/38')
    heading().should('have.text', 'Page 38')
    cy.get('body').type('{rightArrow}')
    cy.location('pathname').should('eq', '/40')
    cy.get('body').type('{leftArrow}')
    cy.location('pathname').should('eq', '/38')
    cy.get('body').type('{leftArrow}')
    cy.location('pathname').should('eq', '/36')

    // ⇧S: skipped slides are shown again.
    cy.get('body').type('{shift}S')
    cy.get('.slidev-notice').should('have.text', 'Showing 2 skipped slides')
    cy.window().then(win => expect(win.localStorage.getItem('slidev-skip-skipped')).to.eq('false'))
    cy.get('body').type('{rightArrow}')
    cy.location('pathname').should('eq', '/37')
    cy.get('[data-testid="skipped-badge"]').should('have.text', 'skipped')

    // Back on, for the other tests: the toggle is shared through the server's nav state.
    cy.get('body').type('{shift}S')
    cy.get('.slidev-notice').should('have.text', 'Skipping 2 skipped slides')
  })

  it('a skipped slide is still reachable directly, with a badge', () => {
    cy.visit(`${BASE}/37`)
    waitForSlide()
    heading().should('have.text', 'Page 37')
    expectCounter('skipped 37 / 40 · 2 skipped')
    // From a skipped slide, next goes to the next kept one.
    cy.get('body').type('{rightArrow}')
    cy.location('pathname').should('eq', '/38')
    cy.get('[data-testid="skipped-badge"]').should('not.exist')
  })

  it('the presenter\'s next preview is the next kept slide', () => {
    cy.visit(`${BASE}/presenter/36`)
    cy.get('.grid-section.next .slidev-page h1').should('have.text', 'Page 38')
  })

  context('marking in edit mode', () => {
    let original = ''
    before(() => {
      cy.readFile(SOURCE).then((text: string) => {
        original = text
      })
    })
    afterEach(() => {
      cy.writeFile(SOURCE, original)
    })

    it('writes one frontmatter line, and ⌘Z restores the source exactly', () => {
      cy.visit(`${BASE}/38`, {
        onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
      })
      waitForSlide()
      cy.get('[data-testid="toggle-slide-skip"]').click({ force: true })
      cy.readFile(SOURCE).should('eq', original.replace('class: skip-target\n', 'class: skip-target\nskip: true\n'))
      expectCounter('skipped 38 / 40 · 3 skipped')

      // As when the pointer leaves the nav bar: the button gives up focus, so shortcuts work.
      cy.focused().blur()
      cy.get('body').type('{cmd}z')
      cy.readFile(SOURCE).should('eq', original)
      expectCounter('38 / 40 · 2 skipped')
    })
  })
})
