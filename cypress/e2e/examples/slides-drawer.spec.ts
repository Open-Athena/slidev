import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
const SOURCE = 'cypress/fixtures/basic/slides.md'
const KEY = 'slidev-slides-drawer'
// The fixture deck's slide count; other specs' fixtures append slides, so keep this current.
const LAST = 35

const drawer = () => cy.get('nav[aria-label="Slide index"]')
const thumb = (no: number) => cy.get(`.slidev-thumb[data-slide-no="${no}"]`)
const stored = () => cy.window().then(win => JSON.parse(win.localStorage.getItem(KEY) ?? 'null'))
const waitForSlide = () => cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
const path = () => cy.location('pathname')

context('slides drawer', () => {
  it('is off by default; ⇧T opens it on the current slide, with titles and keyboard navigation', () => {
    cy.visit(`${BASE}/2`)
    waitForSlide()
    drawer().should('not.exist')

    cy.get('body').type('{shift}T')
    drawer().should('exist')
    cy.get('.slidev-thumb').should('have.length', LAST)
    cy.get('.slidev-thumb').then(($t) => {
      expect($t.toArray().map(t => t.getAttribute('aria-label'))).to.deep.eq([
        'Slide 1: Page 1',
        'Slide 2: Page 2, current slide',
        'Slide 3: Sub page 1',
        'Slide 4: Sub page 2',
        'Slide 5: Page 5',
        'Slide 6: Page 6',
        'Slide 7: Page 7',
        'Slide 8: Right',
        'Slide 9: Page 9',
        'Slide 10: Page 10',
        'Slide 11: Page 11',
        'Slide 12: Page 12',
        'Slide 13: Page 13',
        'Slide 14: Page 14 - v-drag Resize & Position Tests',
        'Slide 15: Page 15 - v-drag Z-Order Tests',
        'Slide 16: Page 16 - v-drag Link Detection Test',
        'Slide 17: Page 17 - v-drag Click Outside Test',
        'Slide 18: Page 18 - v-drag Snap Alignment Tests',
        'Slide 19: Page 19',
        'Slide 20: Page 20',
        'Slide 21: Page 21',
        'Slide 22: Page 17',
        'Slide 23',
        'Slide 24: Page 24',
        'Slide 25: Page 25',
        'Slide 26: Page 26',
        'Slide 27: Page 27',
        'Slide 28: Page 28',
        'Slide 29: Page 29',
        'Slide 30: Page 30',
        'Slide 31: Page 31',
        'Slide 32: Page 32',
        'Slide 33: Page 33',
        'Slide 34: Page 34',
        'Slide 35: Page 35',
      ])
      // Visible text: number + rendered title, or a placeholder for an untitled slide.
      expect([0, 1, 22].map(i => ['.slidev-thumb-no', '.slidev-thumb-title'].map(c => $t[i].querySelector(c)!.textContent!.trim()))).to.deep.eq([
        ['1', 'Page 1'],
        ['2', 'Page 2'],
        ['23', 'Slide 23'],
      ])
      expect($t.toArray().filter(t => t.getAttribute('aria-current') === 'true').map(t => t.dataset.slideNo)).to.deep.eq(['2'])
      // Roving tabindex: only the current slide's thumb is in the tab order.
      expect($t.toArray().filter(t => t.tabIndex === 0).map(t => t.dataset.slideNo)).to.deep.eq(['2'])
    })
    // Opened from the keyboard, so focus moves to the current slide's thumb.
    cy.focused().should('have.attr', 'data-slide-no', '2')

    // The slide canvas sits right of the drawer (default 200 px) instead of under it.
    cy.get('#slide-container').should($c => expect($c[0].getBoundingClientRect().left).to.eq(200))

    // ↓ / ↑ move focus without navigating; Enter jumps.
    cy.focused().type('{downArrow}{downArrow}{downArrow}{upArrow}')
    cy.focused().should('have.attr', 'data-slide-no', '4')
    path().should('eq', '/2')
    cy.focused().type('{enter}')
    path().should('eq', '/4')
    thumb(4).should('have.attr', 'aria-current', 'true')
    thumb(2).should('not.have.attr', 'aria-current')

    // ⇧T (or Esc) from inside the drawer closes it, though the deck's shortcuts are off while a
    // button has focus.
    // (⇧T last: Cypress sends its keyup to the removed thumb, so the deck never sees the keys
    // released, which a real browser does.)
    cy.focused().type('{esc}')
    drawer().should('not.exist')
    cy.get('body').type('{shift}T')
    cy.focused().should('have.attr', 'data-slide-no', '4')
    cy.focused().type('{shift}T')
    drawer().should('not.exist')
    stored().should('deep.eq', { visible: false, width: 200, mode: 'text' })
  })

  it('click navigates, the nav-bar button toggles it, and it stays open across reloads', () => {
    cy.visit(`${BASE}/1`)
    waitForSlide()
    cy.get('[data-testid="toggle-slides-drawer"]').click({ force: true })
    drawer().should('exist')
    thumb(5).click()
    path().should('eq', '/5')
    // A mouse click doesn't leave focus on the thumb, so → still pages the deck.
    cy.focused().should('not.exist')
    cy.get('body').type('{rightArrow}')
    path().should('eq', '/6')
    thumb(6).should('have.attr', 'aria-current', 'true')

    cy.reload()
    waitForSlide()
    drawer().should('exist')
    thumb(6).should('have.attr', 'aria-current', 'true')
    cy.get('[data-testid="toggle-slides-drawer"]').click({ force: true })
    drawer().should('not.exist')
  })

  it('resizes from its right edge, within [120, 400], and remembers the width', () => {
    cy.visit(`${BASE}/1`, {
      onBeforeLoad: win => win.localStorage.setItem(KEY, JSON.stringify({ visible: true, width: 200, mode: 'text' })),
    })
    waitForSlide()
    cy.get('.slidev-drawer-resizer').then(($h) => {
      const r = $h[0].getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + 100
      cy.wrap($h)
        .trigger('pointerdown', { button: 0, pointerId: 1, clientX: x, clientY: y })
        .trigger('pointermove', { pointerId: 1, clientX: x + 80, clientY: y })
        .trigger('pointerup', { pointerId: 1, clientX: x + 80, clientY: y })
    })
    drawer().should($d => expect($d[0].getBoundingClientRect().width).to.eq(280))
    cy.get('#slide-container').should($c => expect($c[0].getBoundingClientRect().left).to.eq(280))
    stored().should('deep.eq', { visible: true, width: 280, mode: 'text' })

    cy.get('.slidev-drawer-resizer').then(($h) => {
      const r = $h[0].getBoundingClientRect()
      cy.wrap($h)
        .trigger('pointerdown', { button: 0, pointerId: 1, clientX: r.left, clientY: 100 })
        .trigger('pointermove', { pointerId: 1, clientX: r.left - 500, clientY: 100 })
        .trigger('pointerup', { pointerId: 1, clientX: r.left - 500, clientY: 100 })
    })
    stored().should('deep.eq', { visible: true, width: 120, mode: 'text' })
  })

  it('live previews mount only near the visible part of the list', () => {
    cy.visit(`${BASE}/1`, {
      onBeforeLoad: win => win.localStorage.setItem(KEY, JSON.stringify({ visible: true, width: 200, mode: 'text' })),
    })
    waitForSlide()
    cy.get('.slidev-thumb-preview').should('have.length', 0)
    cy.get('[data-testid="drawer-mode"]').click()
    stored().should('deep.eq', { visible: true, width: 200, mode: 'live' })
    cy.get('.slidev-thumb-preview').should('have.length', LAST)
    // The slides whose preview is mounted must be one contiguous run, starting at `first` or
    // ending at `last`, and not all of them. (A `should` callback on the query, so it retries.)
    const expectMountedRun = (end: 'first' | 'last') => cy.get('.slidev-thumb').should(($t) => {
      const nos = $t.toArray().filter(t => t.querySelector('.slidev-slide-content')).map(t => +t.dataset.slideNo!)
      const start = end === 'first' ? 1 : LAST + 1 - nos.length
      expect(nos).to.deep.eq(Array.from({ length: nos.length }, (_, i) => start + i))
      expect(nos.length).to.be.within(4, LAST - 1)
    })
    // Previews are 136 px wide (200 px drawer), so ~90 px per thumb: the first slides are within
    // reach, the last ones aren't.
    expectMountedRun('first')
    thumb(2).find('.slidev-slide-content h1').should('have.text', 'Page 2').and('be.visible')
    cy.screenshot('slides-drawer-live', { capture: 'viewport' })

    // Jumping to the end scrolls the current thumb into view: now it's the other way around.
    cy.visit(`${BASE}/${LAST}`)
    waitForSlide()
    thumb(LAST).should('have.attr', 'aria-current', 'true')
    expectMountedRun('last')
  })

  it('drag-to-reorder in edit mode moves a slide, and moving it back restores the source exactly', () => {
    const expectTitle = (no: number, title: string) => expectEventually(`${BASE}/__slidev/slides/${no}.json`, (s: { title: string }) => s.title, title)
    const drag = (from: number, onto: number, half: 'upper' | 'lower') => {
      const dataTransfer = new DataTransfer()
      thumb(from).parent().trigger('dragstart', { dataTransfer })
      thumb(onto).parent().then(($li) => {
        const r = $li[0].getBoundingClientRect()
        const clientY = half === 'upper' ? r.top + 2 : r.bottom - 2
        cy.wrap($li).trigger('dragover', { dataTransfer, clientX: r.left + 10, clientY })
        cy.wrap($li).trigger('drop', { dataTransfer, clientX: r.left + 10, clientY })
      })
      thumb(from).parent().trigger('dragend', { dataTransfer, force: true })
    }

    cy.readFile(SOURCE).then((original: string) => {
      cy.visit(`${BASE}/1`, {
        onBeforeLoad: (win) => {
          win.localStorage.setItem('slidev-edit-mode', 'true')
          win.localStorage.setItem(KEY, JSON.stringify({ visible: true, width: 200, mode: 'text' }))
        },
      })
      waitForSlide()
      cy.contains('Drag to reorder').should('exist')
      // Slide 1 holds the headmatter: not draggable.
      thumb(1).parent().should('have.attr', 'draggable', 'false')
      thumb(26).parent().should('have.attr', 'draggable', 'true')

      // Slide 26 onto the lower half of 27: after it.
      drag(26, 27, 'lower')
      cy.get('.slidev-notice').should('have.text', 'Moved slide 26 to 27')
      expectTitle(26, 'Page 27')
      expectTitle(27, 'Page 26')
      thumb(27).should('have.attr', 'aria-label', 'Slide 27: Page 26')

      // And back: onto the upper half of slide 26 (now "Page 27"), i.e. before it.
      drag(27, 26, 'upper')
      cy.get('.slidev-notice').should('have.text', 'Moved slide 27 to 26')
      expectTitle(26, 'Page 26')
      cy.readFile(SOURCE).should('eq', original)
    })
  })
})
