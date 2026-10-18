import { expectEventually } from '../../poll'

const BASE = 'http://localhost:3041'
const SOURCE = 'cypress/fixtures/basic/slides.md'

// Reordering from the overview rewrites the fixture deck's (tracked) `slides.md`, so the test
// moves a slide and then moves it back, expecting the file byte-identical.
context('slide reordering', () => {
  const expectTitle = (no: number, title: string) => expectEventually(`${BASE}/__slidev/slides/${no}.json`, (s: { title: string }) => s.title, title)

  it('⌘X / ⌘V in the overview moves a slide, and moving it back restores the source exactly', () => {
    cy.readFile(SOURCE).then((original: string) => {
      cy.visit(`${BASE}/26`, {
        onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
      })
      cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
      cy.get('body').type('o')
      cy.contains('Drag to reorder').should('exist')

      // Cut slide 26 and put it after 27.
      cy.get('body').type('{cmd}x')
      cy.get('body').type('{rightArrow}')
      cy.get('body').type('{cmd}v')
      expectTitle(26, 'Page 27')
      expectTitle(27, 'Page 26')
      cy.get('.slidev-notice').should('have.text', 'Moved slide 26 to 27')

      // And back: it's now 27, the selection follows it; put it after 25.
      cy.get('body').type('{cmd}x')
      cy.get('body').type('{leftArrow}{leftArrow}')
      cy.get('body').type('{cmd}v')
      cy.get('.slidev-notice').should('have.text', 'Moved slide 27 to 26')
      cy.readFile(SOURCE).should('eq', original)
    })
  })
})
