import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
const SOURCE = 'cypress/fixtures/basic/slides.md'
const SLUGS = 'cypress/fixtures/basic/slides.slugs.yaml'

// `/<n>-<slug>` URLs: the slug decides which slide (numbers shift as slides are inserted or
// removed before it), old slugs (frontmatter `aliases`, or recorded when a title changes) still
// resolve, and the URL is rewritten to the slide's current one. Fixture slide 40 has
// `aliases: [old-forty]`.
context('slug URLs', () => {
  const expectAt = (path: string, no: number, heading: string) => {
    cy.location('pathname').should('eq', path)
    cy.get(`#slide-content .slidev-page-${no} h1`).should('have.text', heading)
  }

  it('an alias resolves, and the URL becomes the current slug', () => {
    cy.visit(`${BASE}/40-old-forty`)
    expectAt('/40-page-40', 40, 'Page 40')
  })

  it('a bare alias resolves too', () => {
    cy.visit(`${BASE}/old-forty`)
    expectAt('/40-page-40', 40, 'Page 40')
  })

  it('a slug follows its slide when the number is stale', () => {
    cy.visit(`${BASE}/3-page-40`)
    expectAt('/40-page-40', 40, 'Page 40')
  })

  context('editing the markdown', () => {
    let original = ''
    before(() => {
      cy.readFile(SOURCE).then((text: string) => {
        original = text
      })
    })
    afterEach(() => {
      cy.writeFile(SOURCE, original)
      expectEventually(`${BASE}/__slidev/slides/40.json`, (s: { title: string }) => s.title, 'Page 40')
      cy.task('removeFile', SLUGS)
    })

    it('a slide removed before it: `/40-page-40` leads to `/39-page-40`', () => {
      cy.then(() => cy.writeFile(SOURCE, original.replace('\n---\n\n# Page 36\n\nBefore the skipped slides (`skip-slides.spec.ts`).\n', '\n')))
      expectEventually(`${BASE}/__slidev/slides/39.json`, (s: { title: string }) => s.title, 'Page 40')
      cy.visit(`${BASE}/40-page-40`)
      expectAt('/39-page-40', 39, 'Page 40')
    })

    it('a renamed slide: its old slug is recorded and still leads to it', () => {
      cy.then(() => cy.writeFile(SOURCE, original.replace('\n# Page 40\n', '\n# Renamed forty\n')))
      cy.readFile(SLUGS).should((text: string) => {
        const entries = text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.replace(/: .*Z$/, ': <time>'))
        expect(entries).to.deep.eq(['renamed-forty:', '  page-40: <time>'])
      })
      cy.visit(`${BASE}/40-page-40`)
      expectAt('/40-renamed-forty', 40, 'Renamed forty')
    })
  })
})
