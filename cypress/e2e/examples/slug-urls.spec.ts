const BASE = Cypress.config('baseUrl')!

// `/<n>-<slug>` URLs: a slug names its slide even after it moves, old slugs (frontmatter
// `aliases`) still resolve, and the URL is rewritten to the slide's current one. Fixture slide 40
// has `aliases: [old-forty]`.
context('slug URLs', () => {
  const expectAt = (path: string) => {
    cy.location('pathname').should('eq', path)
    cy.get('#slide-content .slidev-page-40 h1').should('have.text', 'Page 40')
  }

  it('an alias resolves, and the URL becomes the current slug', () => {
    cy.visit(`${BASE}/40-old-forty`)
    expectAt('/40-page-40')
  })

  it('a bare alias resolves too', () => {
    cy.visit(`${BASE}/old-forty`)
    expectAt('/40-page-40')
  })

  it('a slug follows its slide when the number is stale', () => {
    cy.visit(`${BASE}/3-page-40`)
    expectAt('/40-page-40')
  })
})
