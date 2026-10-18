export {}

const BASE = 'http://localhost:3041'

// `v-drag.flow` elements keep their slot in an author-built layout (grid / flex columns with
// positioned containers), instead of being pulled out to slide-absolute positions.
context('v-drag (flow layout)', () => {
  interface Box { left: number, top: number, width: number, height: number }

  function box(testId: string): Cypress.Chainable<Box> {
    return cy.get(`[data-testid="${testId}"]`).then(($el) => {
      const { left, top, width, height } = $el[0].getBoundingClientRect()
      return { left, top, width, height }
    })
  }

  // Retrying form, for boxes that settle a frame or two after an interaction.
  function shouldHaveBox(testId: string, expected: Box) {
    cy.get(`[data-testid="${testId}"]`).should(($el) => {
      const { left, top, width, height } = $el[0].getBoundingClientRect()
      expectBox({ left, top, width, height }, expected)
    })
  }

  function expectBox(actual: Box, expected: Box) {
    expect(actual.left).to.be.closeTo(expected.left, 1)
    expect(actual.top).to.be.closeTo(expected.top, 1)
    expect(actual.width).to.be.closeTo(expected.width, 1)
    expect(actual.height).to.be.closeTo(expected.height, 1)
  }

  beforeEach(() => {
    cy.visit(`${BASE}/24`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
    }).wait(500)
    // Slide scale starts at 0 on a cold load; wait for real geometry before reading rects.
    cy.get('#slide-content').should($slide => expect($slide[0].getBoundingClientRect().width).to.be.greaterThan(100))
    // The images must have loaded for `object-fit` to letterbox them.
    cy.get('[data-testid="flow-a"]').should($img => expect(($img[0] as HTMLImageElement).naturalWidth).to.eq(800))
  })

  it('renders as authored before any edit', () => {
    cy.get('[data-testid="flow-a"]').should('have.attr', 'style', 'width: 100%; height: 200px; object-fit: contain;')
  })

  it('selecting a letterboxed image fits the box to its pixels and leaves the layout alone', () => {
    box('flow-caption').then((caption) => {
      box('flow-b').then((b) => {
        box('flow-a').then((a) => {
          cy.get('[data-testid="flow-a"]').click()
          cy.get('#drag-control-container').should('have.attr', 'data-drag-id', 'flow-a')
          // 2:1 image, contain-fit into the box and centered: the selection shrinks to its pixels.
          const pixelsWidth = Math.min(a.width, a.height * 2)
          const pixelsHeight = pixelsWidth / 2
          shouldHaveBox('flow-a', {
            left: a.left + (a.width - pixelsWidth) / 2,
            top: a.top + (a.height - pixelsHeight) / 2,
            width: pixelsWidth,
            height: pixelsHeight,
          })
          cy.get('[data-testid="flow-a"]').should('have.css', 'position', 'relative')
          shouldHaveBox('flow-b', b)
          // The caption moves up by the letterbox bands that are no longer part of the slot.
          shouldHaveBox('flow-caption', { ...caption, top: caption.top - (a.height - pixelsHeight) })
        })
      })
    })
  })

  it('dragging moves only the element, and the position survives a reload', () => {
    cy.get('[data-testid="flow-a"]').click()
    box('flow-b').then((b) => {
      box('flow-a').then((a) => {
        const cx = a.left + a.width / 2
        const cy0 = a.top + a.height / 2
        cy.get('[data-testid="flow-a"]')
          .trigger('pointerdown', { button: 0, pointerId: 1, buttons: 1, clientX: cx, clientY: cy0, force: true })
        cy.document().trigger('pointermove', { clientX: cx + 30, clientY: cy0 + 20, buttons: 1, pointerId: 1 })
        cy.document().trigger('pointermove', { clientX: cx + 60, clientY: cy0 + 40, buttons: 1, pointerId: 1 })
        cy.document().trigger('pointerup', { pointerId: 1 })
        const moved = { ...a, left: a.left + 60, top: a.top + 40 }
        shouldHaveBox('flow-a', moved)
        shouldHaveBox('flow-b', b)
        // Let the history debounce commit the edit to the state DB before reloading.
        cy.wait(1500)
        cy.reload().wait(800)
        shouldHaveBox('flow-a', moved)
        shouldHaveBox('flow-b', b)
      })
    })
  })
})
