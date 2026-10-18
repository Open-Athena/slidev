export {}

const BASE = 'http://localhost:3041'

context('toolbar tooltips', () => {
  it('show the label and the hotkeys from the shortcut table, quickly, with no native title', () => {
    cy.visit(`${BASE}/1`)
    cy.get('button[aria-label="Show slide overview"]', { timeout: 30000 }).should('not.have.attr', 'title')
    cy.get('button[aria-label="Show slide overview"]').trigger('pointerenter', { force: true })
    cy.get('.slidev-tooltip', { timeout: 300 }).should(($tip) => {
      expect([
        $tip.find('span').text(),
        $tip.find('kbd').toArray().map(k => k.textContent),
      ]).to.deep.eq(['Show slide overview', ['o', '`']])
    })
    // Moving straight from one button to the next opens its tooltip at once (under the 150 ms
    // first-open delay). Both events in one step, so Cypress's command overhead can't outlast
    // the delay group.
    cy.document().then((doc) => {
      doc.querySelector('button[aria-label="Show slide overview"]')!.dispatchEvent(new PointerEvent('pointerleave'))
      doc.querySelector('button[aria-label="Next"]')!.dispatchEvent(new PointerEvent('pointerenter'))
    })
    cy.get('.slidev-tooltip', { timeout: 140 }).should(($tip) => {
      expect($tip.find('kbd').toArray().map(k => k.textContent)).to.deep.eq(['→', 'space'])
    })
  })
})
