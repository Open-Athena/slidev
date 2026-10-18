import { expectEventually } from '../../poll'

const BASE = 'http://localhost:3041'
const SLIDE = 25

// In-app text editing writes to the fixture deck's (tracked) `slides.md`; every test puts the
// slide's original source back afterwards.
context('text editing', () => {
  let original: string

  function source(): Cypress.Chainable<string> {
    return cy.request(`${BASE}/__slidev/slides/${SLIDE}.json`)
      .then(({ body }) => (typeof body === 'string' ? JSON.parse(body) : body).content as string)
  }

  // Saving is async (fetch + POST + history event); poll until it lands.
  function expectSource(expected: string) {
    expectEventually(`${BASE}/__slidev/slides/${SLIDE}.json`, (s: { content: string }) => s.content, expected)
  }

  function visit(editing = true) {
    cy.visit(`${BASE}/${SLIDE}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', String(editing)),
    })
    // Generous timeouts: the first visit after the fixture server starts compiles the deck.
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
    cy.contains('li', 'first item', { timeout: 30000 }).should('have.attr', 'data-slidev-md')
  }

  // Double-click near the block's top-left, on its first line of text: an element's center can
  // fall on a nested block (a list item's box includes its nested list), and editing that is
  // correct behavior, just not what the test means.
  function startEditing(selector: string, text: string, alt = false) {
    cy.contains(selector, text).dblclick(8, 8, { altKey: alt })
  }

  before(() => {
    source().then(s => original = s)
  })

  afterEach(() => {
    cy.request('POST', `${BASE}/__slidev/slides/${SLIDE}.json`, { content: original, skipHmr: false })
  })

  it('does nothing outside edit mode', () => {
    visit(false)
    startEditing('li', 'first item')
    cy.contains('li', 'first item').should('not.have.attr', 'contenteditable')
    cy.get('.slidev-text-raw-editor').should('not.exist')
  })

  it('edits a list item in place and writes its source line', () => {
    visit()
    startEditing('li', 'first item')
    cy.focused().should('have.attr', 'contenteditable', 'true').type('{moveToEnd} edited{enter}')
    expectSource(original.replace('- first item\n', '- first item edited\n'))
    cy.contains('li', 'first item edited').should('not.have.attr', 'contenteditable')
  })

  it('a double-click between blocks edits the block whose word the browser selects', () => {
    visit()
    // Dispatch on the list itself (as a click in the gap between items lands), at the first item's text.
    cy.contains('li', 'first item').then(($li) => {
      const li = $li[0].getBoundingClientRect()
      const ul = $li[0].parentElement!.getBoundingClientRect()
      cy.wrap($li[0].parentElement!).dblclick(li.left - ul.left + 8, li.top - ul.top + li.height / 2, { force: true })
    })
    cy.focused().should('have.attr', 'contenteditable', 'true')
    cy.focused().should('have.text', 'first item').type('{esc}')
  })

  it('keeps inline formatting when editing rich text', () => {
    visit()
    startEditing('p', 'text to edit')
    cy.focused().should('have.attr', 'contenteditable', 'true').type('{moveToEnd} Done.{enter}')
    expectSource(original.replace('Some **bold** text to edit.\n', 'Some **bold** text to edit. Done.\n'))
  })

  it('esc cancels, leaving source and DOM untouched', () => {
    visit()
    startEditing('p', 'text to edit')
    cy.focused().should('have.attr', 'contenteditable', 'true').type('{moveToEnd} zzz{esc}')
    cy.contains('p', 'text to edit').should('not.contain.text', 'zzz')
    cy.contains('p', 'text to edit').should('not.have.attr', 'contenteditable')
    expectSource(original)
  })

  it('edits a table cell, escaping pipes', () => {
    visit()
    startEditing('td', 'one')
    cy.focused().should('have.attr', 'contenteditable', 'true').type('{moveToEnd} | 1{enter}')
    expectSource(original.replace('| a | one |', '| a | one \\| 1 |'))
  })

  it('⌥ + double-click edits the raw markdown', () => {
    visit()
    startEditing('p', 'text to edit', true)
    cy.get('.slidev-text-raw-editor').should('have.value', 'Some **bold** text to edit.').type('{selectall}New *text*{enter}')
    cy.get('.slidev-text-raw-editor').should('not.exist')
    expectSource(original.replace('Some **bold** text to edit.\n', 'New *text*\n'))
  })

  it('⌘Z undoes a text edit', () => {
    visit()
    startEditing('li', 'second item')
    cy.focused().should('have.attr', 'contenteditable', 'true').type('{moveToEnd}!{enter}')
    expectSource(original.replace('- second item\n', '- second item!\n'))
    cy.get('body').type('{cmd}z')
    expectSource(original)
  })
})
