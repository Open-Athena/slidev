export {}

const BASE = 'http://localhost:3041'

context('v-drag', () => {
  function goPage(no: number) {
    cy.visit(`${BASE}/${no}`).wait(500)
  }

  describe('selection', () => {
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

  describe('dragging', () => {
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

        // Move pointer (events go to document after pointerdown). `pointerId` MUST match
        // the pointerdown's — the body-drag handler ignores moves with a different id.
        cy.document().trigger('pointermove', { clientX: 400, clientY: 400, buttons: 1, pointerId: 1 })
        cy.document().trigger('pointerup', { pointerId: 1 })

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

  describe('z-order (keyboard)', () => {
    beforeEach(() => {
      goPage(15) // v-drag Z-Order Tests page
    })

    // Z-order has no on-canvas buttons — it's driven by Cmd/Ctrl+Arrow shortcuts,
    // handled by DragControl's window-level capture-phase `onZOrderKeyDown` listener
    // (Cmd+Up = forward, Cmd+Down = backward, add Shift for to-front/to-back). Dispatch
    // straight to `window` so the capture listener fires.
    function pressZOrder(key: 'ArrowUp' | 'ArrowDown', shift = false) {
      cy.window().then((win) => {
        win.dispatchEvent(new win.KeyboardEvent('keydown', {
          key,
          metaKey: true,
          shiftKey: shift,
          bubbles: true,
          cancelable: true,
        }))
      })
    }

    it('cmd+ArrowUp brings the selected element forward (raises z-index)', () => {
      cy.get('[data-testid="stack-a"]').click() // z:100, below b(101) and c(102)
      cy.wait(200)
      cy.get('[data-testid="stack-a"]').then(($el) => {
        const initialZIndex = Number.parseInt($el.css('z-index'))
        pressZOrder('ArrowUp')
        cy.wait(200)
        cy.get('[data-testid="stack-a"]').should(($el2) => {
          expect(Number.parseInt($el2.css('z-index'))).to.be.greaterThan(initialZIndex)
        })
      })
    })

    it('cmd+ArrowDown sends the selected element backward (lowers z-index)', () => {
      cy.get('[data-testid="stack-c"]').click() // z:102, above a(100) and b(101)
      cy.wait(200)
      cy.get('[data-testid="stack-c"]').then(($el) => {
        const initialZIndex = Number.parseInt($el.css('z-index'))
        pressZOrder('ArrowDown')
        cy.wait(200)
        cy.get('[data-testid="stack-c"]').should(($el2) => {
          expect(Number.parseInt($el2.css('z-index'))).to.be.lessThan(initialZIndex)
        })
      })
    })

    it('cmd+Shift+ArrowUp brings the element above all its siblings', () => {
      cy.get('[data-testid="stack-a"]').click() // starts lowest at z:100
      cy.wait(200)
      pressZOrder('ArrowUp', true)
      cy.wait(200)
      cy.get('[data-testid="stack-a"]').then(($a) => {
        const za = Number.parseInt($a.css('z-index'))
        cy.get('[data-testid="stack-b"]').should(($b) => {
          expect(za).to.be.greaterThan(Number.parseInt($b.css('z-index')))
        })
        cy.get('[data-testid="stack-c"]').should(($c) => {
          expect(za).to.be.greaterThan(Number.parseInt($c.css('z-index')))
        })
      })
    })
  })

  describe('link detection', () => {
    beforeEach(() => {
      goPage(16) // v-drag Link Detection Test page
    })

    it('clicking linked element does not navigate', () => {
      // Click on the linked element
      cy.get('[data-testid="link-box"]').click()
      cy.wait(500)

      // Should still be on the same page (not navigated to example.com)
      cy.url().should('include', 'localhost:3041')
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

  describe('resize', () => {
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

    it('reset aspect ratio button appears only after a free corner resize', () => {
      cy.get('[data-testid="box1"]').click()
      cy.wait(200)

      // Fresh selection: AR unchanged, so the reset-AR button is absent (it's `v-if`d on
      // `hasAspectRatioChanged`).
      cy.get('#drag-control-container button[title="Reset aspect ratio"]').should('not.exist')

      // Free-drag a corner handle to skew the aspect ratio. The corner handlers live on the
      // handle element (which re-renders as the box resizes), need `buttons: 1` on the
      // pointerdown to arm `currentDrag`, and a matching `pointerId`. Re-query the handle for
      // each event so a re-render between events can't leave us dispatching to a stale node,
      // and send two moves with different x/y ratios to guarantee the AR actually changes.
      const handle = '#drag-control-container div[style*="nwse-resize"]'
      cy.get(handle).first().then(($h) => {
        const r = $h[0].getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy2 = r.top + r.height / 2
        cy.get(handle).first().trigger('pointerdown', { button: 0, buttons: 1, pointerId: 1, clientX: cx, clientY: cy2, force: true })
        cy.get(handle).first().trigger('pointermove', { button: 0, buttons: 1, pointerId: 1, clientX: cx + 120, clientY: cy2 + 120, force: true })
        cy.get(handle).first().trigger('pointermove', { button: 0, buttons: 1, pointerId: 1, clientX: cx + 160, clientY: cy2 + 30, force: true })
        cy.get(handle).first().trigger('pointerup', { pointerId: 1, force: true })
      })
      cy.wait(200)

      // AR now differs from the original → the reset button is shown.
      cy.get('#drag-control-container button[title="Reset aspect ratio"]').should('exist')

      // Clicking it restores the original AR, so the button hides again.
      cy.get('#drag-control-container button[title="Reset aspect ratio"]').click()
      cy.wait(200)
      cy.get('#drag-control-container button[title="Reset aspect ratio"]').should('not.exist')
    })
  })

  describe('click outside (dedicated test)', () => {
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

  describe('snap alignment', () => {
    // Page 18: snap-target at dragPos 480,270,120,80 (center x0=540, y0=310)
    //          snap-mover at dragPos 100,100,100,80  (center x0=150, y0=140)
    beforeEach(() => {
      goPage(18)
    })

    it('initial layout: two boxes at distinct positions', () => {
      cy.get('[data-testid="snap-target"]').should('exist')
      cy.get('[data-testid="snap-mover"]').should('exist')
      cy.screenshot('snap-initial-layout')
    })

    it('snap guide lines appear when dragging near a snap target', () => {
      // No snap guides initially
      cy.get('.snap-guide').should('not.exist')

      cy.get('[data-testid="snap-target"]').then(($target) => {
        const targetRect = $target[0].getBoundingClientRect()
        // Drag near the target's center (slightly offset to trigger snap)
        const nearTargetX = targetRect.left + targetRect.width / 2 + 3
        const nearTargetY = targetRect.top + targetRect.height / 2 + 3

        cy.get('[data-testid="snap-mover"]')
          .trigger('pointerdown', { button: 0, pointerId: 1, buttons: 1, force: true })

        // Move near the target - should trigger snap guides. `pointerId` must match the
        // pointerdown or the body-drag handler drops the move. Send it twice so the snap
        // reliably recomputes at the final position even if one synthetic event is dropped
        // under CI timing.
        cy.document()
          .trigger('pointermove', { clientX: nearTargetX, clientY: nearTargetY, buttons: 1, pointerId: 1 })
          .trigger('pointermove', { clientX: nearTargetX, clientY: nearTargetY, buttons: 1, pointerId: 1 })

        cy.wait(100)

        // Snap guide lines should appear
        cy.get('.snap-guide').should('have.length.at.least', 1)
        cy.screenshot('snap-guides-visible')

        cy.document().trigger('pointerup', { pointerId: 1 })
        cy.wait(100)

        // Snap guides should disappear after drag ends
        cy.get('.snap-guide').should('not.exist')
      })
    })

    it('snap guide lines do NOT appear when Meta is held', () => {
      cy.get('[data-testid="snap-target"]').then(($target) => {
        const targetRect = $target[0].getBoundingClientRect()
        const nearTargetX = targetRect.left + targetRect.width / 2 + 3
        const nearTargetY = targetRect.top + targetRect.height / 2 + 3

        cy.get('[data-testid="snap-mover"]')
          .trigger('pointerdown', { button: 0, pointerId: 1, buttons: 1, force: true })

        // Move near target with Meta key held - should NOT snap (Meta disables snapping).
        // `pointerId` must match the pointerdown so the move actually drives the drag —
        // otherwise this would pass vacuously (no drag at all → no guides).
        cy.document()
          .trigger('pointermove', {
            clientX: nearTargetX,
            clientY: nearTargetY,
            buttons: 1,
            pointerId: 1,
            metaKey: true,
          })

        cy.wait(100)

        // No snap guides when Meta is held
        cy.get('.snap-guide').should('not.exist')
        cy.screenshot('snap-meta-no-guides')

        cy.document().trigger('pointerup', { pointerId: 1 })
      })
    })

    it('element snaps to slide center', () => {
      // Get the slide element to compute center coordinates
      cy.get('#slide-content').then(($slide) => {
        const slideRect = $slide[0].getBoundingClientRect()
        // Drag mover to approximate slide center
        const centerX = slideRect.left + slideRect.width / 2 + 3
        const centerY = slideRect.top + slideRect.height / 2 + 3

        cy.get('[data-testid="snap-mover"]')
          .trigger('pointerdown', { button: 0, pointerId: 1, buttons: 1, force: true })

        cy.document()
          .trigger('pointermove', { clientX: centerX, clientY: centerY, buttons: 1, pointerId: 1 })
          .trigger('pointermove', { clientX: centerX, clientY: centerY, buttons: 1, pointerId: 1 })

        cy.wait(100)
        cy.get('.snap-guide').should('have.length.at.least', 1)
        cy.screenshot('snap-to-slide-center')

        cy.document().trigger('pointerup', { pointerId: 1 })
      })
    })
  })
})
