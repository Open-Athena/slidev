import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
const SLIDE = 30

// WYSIWYG block editing (prototype; fixture slide 30 turns it on in its frontmatter). Each test
// edits the fixture deck's (tracked) `slides.md` and puts the slide's source back afterwards.
context('WYSIWYG editing', () => {
  let original: string

  const expectSource = (expected: string) =>
    expectEventually(`${BASE}/__slidev/slides/${SLIDE}.json`, (s: { content: string }) => s.content, expected)

  function visit() {
    cy.visit(`${BASE}/${SLIDE}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
    })
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
    cy.contains('.slidev-page-30 li', 'two', { timeout: 30000 }).should('have.attr', 'data-slidev-md')
  }

  before(() => {
    cy.request(`${BASE}/__slidev/slides/${SLIDE}.json`).then(({ body }) => {
      original = (typeof body === 'string' ? JSON.parse(body) : body).content
    })
  })

  afterEach(() => {
    cy.request('POST', `${BASE}/__slidev/slides/${SLIDE}.json`, { content: original, skipHmr: false })
  })

  it('edits the run of markdown blocks up to the HTML block, rewriting only the changed line', () => {
    visit()
    cy.contains('.slidev-page-30 li', 'two').dblclick(8, 8)
    cy.get('.slidev-wysiwyg .ProseMirror', { timeout: 20000 }).should(($pm) => {
      expect($pm.find('h1, p, li').toArray().map(e => e.childNodes[0]?.textContent)).to.deep.eq(['Page 30', 'Intro with Q&A and ~1 day.', 'one', 'one', 'two', 'two'])
    })
    cy.get('.slidev-wysiwyg .ProseMirror').contains('p', 'two').type('{moveToEnd}!')
    cy.get('.slidev-wysiwyg .ProseMirror').type('{cmd}{enter}')
    cy.get('.slidev-wysiwyg').should('not.exist')
    // `Q&A` and `~1 day` keep their bytes (the serializer would escape them).
    expectSource(original.replace('- two\n', '- two!\n'))
    cy.get('body').type('{cmd}z')
    expectSource(original)
  })

  it('a paragraph after an HTML block is its own region; Esc saves, ⌘Z restores', () => {
    visit()
    // The undo button's label names the latest edit; the save below must change it.
    cy.get('[data-testid="undo"]').invoke('attr', 'aria-label').then((before) => {
      cy.contains('.slidev-page-30 p', 'After the HTML.').dblclick(8, 8)
      cy.get('.slidev-wysiwyg .ProseMirror', { timeout: 20000 }).should(($pm) => {
        expect($pm.find('h1, p, li').toArray().map(e => e.textContent)).to.deep.eq(['After the HTML.'])
      })
      cy.get('.slidev-wysiwyg .ProseMirror').type('{moveToEnd} zzz{esc}')
      cy.get('.slidev-wysiwyg').should('not.exist')
      // (The slide's content has no trailing newline: this is its last line.)
      expectSource(original.replace(/After the HTML\.$/, 'After the HTML. zzz'))
      cy.contains('.slidev-page-30 p', 'After the HTML. zzz').should('be.visible')
      // The source is written before the history event is recorded: wait for it.
      cy.get('[data-testid="undo"]').should('not.have.attr', 'aria-label', before)
      cy.get('body').type('{cmd}z')
      expectSource(original)
    })
  })
})
