export {}

const BASE = 'http://localhost:3041'

context('v-drag', () => {
  function goPage(no: number) {
    cy.visit(`${BASE}/${no}`).wait(500)
  }

  describe('Selection', () => {
    beforeEach(() => {
      goPage(14) // v-drag Resize & Position Tests page
    })

    it('click to select shows DragControl handles', () => {
      // Initially no drag control should be visible
      cy.get('#drag-control-container').should('not.exist')

      // Click on box1 to select it
      cy.get('[data-testid="box1"]').click()
      cy.wait(200)

      // DragControl should now be visible
      cy.get('#drag-control-container').should('exist')
      cy.get('#drag-control-container').should('have.attr', 'data-drag-id', 'box1')
    })

    it('click outside deselects element', () => {
      // Click on box1 to select it
      cy.get('[data-testid="box1"]').click()
      cy.wait(200)
      cy.get('#drag-control-container').should('exist')

      // Click outside the box (on the slide background)
      cy.get('#slideshow').click(50, 500)
      cy.wait(200)

      // DragControl should be hidden
      cy.get('#drag-control-container').should('not.exist')
    })

    it('can select different elements sequentially', () => {
      // Click on box1 to select it
      cy.get('[data-testid="box1"]').click()
      cy.wait(200)
      cy.get('#drag-control-container').should('have.attr', 'data-drag-id', 'box1')

      // Deselect by clicking outside
      cy.get('#slideshow').click(50, 500)
      cy.wait(200)
      cy.get('#drag-control-container').should('not.exist')

      // Now click on box2 to select it
      cy.get('[data-testid="box2"]').click()
      cy.wait(200)

      // DragControl should now show box2
      cy.get('#drag-control-container').should('have.attr', 'data-drag-id', 'box2')
    })
  })

  describe('Dragging', () => {
    beforeEach(() => {
      goPage(14) // v-drag Resize & Position Tests page
    })

    it('drag to move updates position', () => {
      // Get initial position
      cy.get('[data-testid="box1"]').then(($el) => {
        const initialLeft = $el.css('left')
        const initialTop = $el.css('top')

        // Drag the element directly (v-drag handles drag on pointerdown)
        cy.get('[data-testid="box1"]')
          .trigger('pointerdown', { button: 0, pointerId: 1, buttons: 1, force: true })

        // Move pointer (events go to document after pointerdown)
        cy.document().trigger('pointermove', { clientX: 400, clientY: 400, buttons: 1 })
        cy.document().trigger('pointerup')

        cy.wait(200)

        // Position should have changed
        cy.get('[data-testid="box1"]').should(($el2) => {
          const newLeft = $el2.css('left')
          const newTop = $el2.css('top')
          expect(newLeft).not.to.eq(initialLeft)
          expect(newTop).not.to.eq(initialTop)
        })
      })
    })
  })

  describe('Z-Order', () => {
    beforeEach(() => {
      goPage(15) // v-drag Z-Order Tests page
    })

    it('z-order buttons are visible when element is selected', () => {
      // Click to select stack-a
      cy.get('[data-testid="stack-a"]').click()
      cy.wait(200)

      // Z-order buttons should be visible
      cy.get('#drag-control-container button[title*="forward"]').should('exist')
      cy.get('#drag-control-container button[title*="backward"]').should('exist')
    })

    it('bring forward increases z-index', () => {
      // Click to select stack-a (initial z-index: 100)
      cy.get('[data-testid="stack-a"]').click()
      cy.wait(200)

      // Get initial z-index
      cy.get('[data-testid="stack-a"]').then(($el) => {
        const initialZIndex = Number.parseInt($el.css('z-index'))

        // Click bring forward button
        cy.get('#drag-control-container button[title*="forward"]').first().click()
        cy.wait(200)

        // z-index should have increased
        cy.get('[data-testid="stack-a"]').should(($el2) => {
          const newZIndex = Number.parseInt($el2.css('z-index'))
          expect(newZIndex).to.be.greaterThan(initialZIndex)
        })
      })
    })

    it('send backward decreases z-index', () => {
      // Click to select stack-c (initial z-index: 102)
      cy.get('[data-testid="stack-c"]').click()
      cy.wait(200)

      // Get initial z-index
      cy.get('[data-testid="stack-c"]').then(($el) => {
        const initialZIndex = Number.parseInt($el.css('z-index'))

        // Click send backward button
        cy.get('#drag-control-container button[title*="backward"]').first().click()
        cy.wait(200)

        // z-index should have decreased
        cy.get('[data-testid="stack-c"]').should(($el2) => {
          const newZIndex = Number.parseInt($el2.css('z-index'))
          expect(newZIndex).to.be.lessThan(initialZIndex)
        })
      })
    })
  })

  describe('Link Detection', () => {
    beforeEach(() => {
      goPage(16) // v-drag Link Detection Test page
    })

    it('clicking linked element does not navigate', () => {
      // Store current URL
      cy.url().then((url) => {
        // Click on the linked element
        cy.get('[data-testid="link-box"]').click()
        cy.wait(500)

        // Should still be on the same page (not navigated to example.com)
        cy.url().should('include', 'localhost:3041')
      })
    })

    it('shows floating link button for linked elements', () => {
      // Click to select the linked element
      cy.get('[data-testid="link-box"]').click()
      cy.wait(200)

      // DragControl should exist
      cy.get('#drag-control-container').should('exist')

      // Floating link button should be visible with the URL
      cy.get('#drag-control-container').contains('example.com').should('exist')
    })
  })

  describe('Resize', () => {
    beforeEach(() => {
      goPage(14) // v-drag Resize & Position Tests page
    })

    it('resize handles are visible when selected', () => {
      // Click on box1 to select it
      cy.get('[data-testid="box1"]').click()
      cy.wait(200)

      // DragControl should show resize handles (corner and border handles)
      cy.get('#drag-control-container').should('exist')

      // Corner handles use nwse-resize or nesw-resize cursor
      cy.get('#drag-control-container div[style*="cursor"]').should('have.length.at.least', 4)
    })

    it('reset aspect ratio button is visible', () => {
      // Click on box1 to select it
      cy.get('[data-testid="box1"]').click()
      cy.wait(200)

      // Reset aspect ratio button should be visible
      cy.get('#drag-control-container button[title="Reset aspect ratio"]').should('exist')
    })
  })

  describe('Click Outside (Dedicated Test)', () => {
    beforeEach(() => {
      goPage(17) // v-drag Click Outside Test page
    })

    it('selecting and deselecting works correctly', () => {
      // Click on the box to select
      cy.get('[data-testid="click-outside-box"]').click()
      cy.wait(200)

      // DragControl should be visible
      cy.get('#drag-control-container').should('exist')

      // Click on empty area of the slide
      cy.get('body').click(700, 100)
      cy.wait(200)

      // DragControl should be hidden
      cy.get('#drag-control-container').should('not.exist')
    })
  })
})
