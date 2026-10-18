import { expectEventually } from '../../poll'

const BASE = 'http://localhost:3041'
const LAYOUT_SLIDE = 26
const HTML_SLIDE = 27

interface SlideJson {
  content: string
  frontmatter: Record<string, unknown>
}

// Column resizing writes to the fixture deck's (tracked) `slides.md`: slide 26's `cols`
// frontmatter and slide 27's inline grid style. Every test puts both back afterwards.
context('column resizing', () => {
  let originalHtml: string

  function slide(no: number): Cypress.Chainable<SlideJson> {
    return cy.request(`${BASE}/__slidev/slides/${no}.json`)
      .then(({ body }) => (typeof body === 'string' ? JSON.parse(body) : body) as SlideJson)
  }

  // Saving is async (fetch + POST + history event); poll until it lands.
  function expectCols(expected: string | undefined) {
    expectEventually(`${BASE}/__slidev/slides/${LAYOUT_SLIDE}.json`, (s: SlideJson) => s.frontmatter.cols, expected)
  }
  function expectHtml(expected: string) {
    expectEventually(`${BASE}/__slidev/slides/${HTML_SLIDE}.json`, (s: SlideJson) => s.content, expected)
  }

  // Slide 27's source after its first column is widened by 20% (`1fr 1fr` → `1.5fr 1fr`).
  function resized(): string {
    return originalHtml.replace('style="grid-template-columns: 1fr 1fr"', 'style="grid-template-columns: 1.5fr 1fr"')
  }

  function visit(no: number, editing = true) {
    cy.visit(`${BASE}/${no}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', String(editing)),
    })
    // Generous timeouts: the first visit after the fixture server starts compiles the deck.
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
  }

  /**
   * Hover the boundary after the grid's first column, then drag it by `fraction` of the first
   * column's width. `meta` (⌘) turns off snapping.
   */
  function dragBoundary(grid: string, fraction: number, meta = true) {
    cy.get(grid, { timeout: 30000 }).should('have.css', 'display', 'grid').then(($g) => {
      const el = $g[0]
      const rect = el.getBoundingClientRect()
      const scale = rect.width / el.offsetWidth
      const style = getComputedStyle(el)
      const first = Number.parseFloat(style.gridTemplateColumns.split(' ')[0])
      const gap = Number.parseFloat(style.columnGap) || 0
      const x = rect.left + Number.parseFloat(style.paddingLeft) * scale + (first + gap / 2) * scale
      const y = rect.top + rect.height / 2
      const dx = first * fraction * scale
      cy.document().trigger('pointermove', { clientX: x, clientY: y, buttons: 0, pointerType: 'mouse' })
      cy.get('.slidev-cols-handle').should('be.visible')
      cy.get('.slidev-cols-handle')
        .trigger('pointerdown', { button: 0, buttons: 1, pointerId: 1, clientX: x, clientY: y, force: true })
        .trigger('pointermove', { buttons: 1, pointerId: 1, clientX: x + dx / 2, clientY: y, metaKey: meta, force: true })
        .trigger('pointermove', { buttons: 1, pointerId: 1, clientX: x + dx, clientY: y, metaKey: meta, force: true })
        .trigger('pointerup', { pointerId: 1, clientX: x + dx, clientY: y, force: true })
    })
  }

  before(() => {
    slide(HTML_SLIDE).then(s => originalHtml = s.content)
  })

  afterEach(() => {
    cy.request('POST', `${BASE}/__slidev/slides/${LAYOUT_SLIDE}.json`, { frontmatter: { cols: null }, skipHmr: false })
    cy.request('POST', `${BASE}/__slidev/slides/${HTML_SLIDE}.json`, { content: originalHtml, skipHmr: false })
  })

  it('shows no handle outside edit mode', () => {
    visit(LAYOUT_SLIDE, false)
    cy.get('.two-columns', { timeout: 30000 }).then(($g) => {
      const rect = $g[0].getBoundingClientRect()
      cy.document().trigger('pointermove', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: 0, pointerType: 'mouse' })
    })
    cy.wait(100)
    cy.get('.slidev-cols-handle').should('not.be.visible')
  })

  it('dragging a layout\'s divider saves `cols` frontmatter, which re-renders the split', () => {
    visit(LAYOUT_SLIDE)
    dragBoundary('.two-columns', 0.2)
    expectCols('60/40')
    cy.get('.two-columns').should(($g) => {
      const [a, b] = getComputedStyle($g[0]).gridTemplateColumns.split(' ').map(Number.parseFloat)
      expect(Math.round(a / (a + b) * 100)).to.eq(60)
    })
  })

  it('snaps to ⅓ without ⌘', () => {
    visit(LAYOUT_SLIDE)
    // ½ → 0.34 of the width (34/66 unsnapped): within the snap distance of ⅓, and of no other ratio.
    dragBoundary('.two-columns', -0.32, false)
    expectCols('33/67')
  })

  it('dragging an HTML grid\'s gap rewrites its inline style', () => {
    visit(HTML_SLIDE)
    dragBoundary('[data-slidev-html].grid', 0.2)
    expectHtml(resized())
  })

  it('double-clicking the handle resets the split', () => {
    visit(LAYOUT_SLIDE)
    dragBoundary('.two-columns', 0.2)
    expectCols('60/40')
    cy.get('.two-columns').should(($g) => {
      const [a, b] = getComputedStyle($g[0]).gridTemplateColumns.split(' ').map(Number.parseFloat)
      expect(Math.round(a / (a + b) * 100)).to.eq(60)
    })
    cy.get('.two-columns').then(($g) => {
      const el = $g[0]
      const rect = el.getBoundingClientRect()
      const scale = rect.width / el.offsetWidth
      const style = getComputedStyle(el)
      const first = Number.parseFloat(style.gridTemplateColumns.split(' ')[0])
      const x = rect.left + (Number.parseFloat(style.paddingLeft) + first) * scale
      const y = rect.top + rect.height / 2
      cy.document().trigger('pointermove', { clientX: x, clientY: y, buttons: 0, pointerType: 'mouse' })
      // A real double-click's first click must leave the handle up for the second to land on.
      cy.get('.slidev-cols-handle')
        .trigger('pointerdown', { button: 0, buttons: 1, pointerId: 1, clientX: x, clientY: y })
        .trigger('pointerup', { pointerId: 1, clientX: x, clientY: y })
      cy.get('.slidev-cols-handle').should('be.visible').dblclick()
    })
    expectCols(undefined)
  })

  it('⌘Z undoes a resize, restoring the source exactly', () => {
    visit(HTML_SLIDE)
    dragBoundary('[data-slidev-html].grid', 0.2)
    expectHtml(resized())
    cy.get('body').type('{cmd}z')
    expectHtml(originalHtml)
  })
})
