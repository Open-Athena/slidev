import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
const SLIDE = 29

// List structure keys in in-app text editing. Each test edits the fixture deck's (tracked)
// `slides.md` and puts the slide's source back afterwards.
context('list editing', () => {
  let original: string

  const expectSource = (expected: string) =>
    expectEventually(`${BASE}/__slidev/slides/${SLIDE}.json`, (s: { content: string }) => s.content, expected)

  function visit() {
    cy.visit(`${BASE}/${SLIDE}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
    })
    cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))
    cy.contains('li', 'alpha', { timeout: 30000 }).should('have.attr', 'data-slidev-md')
  }

  // Source line of each item's text on the fixture slide (`cy.contains('li', 'beta')` would pick
  // the nested `beta one`, the deepest match).
  const LINE: Record<string, number> = { alpha: 2, beta: 3, gamma: 5, two: 8, done: 12 }

  // Edit an item (double-click on its first line), caret at its start or end.
  function edit(text: string, caret: 'start' | 'end' = 'end') {
    cy.get(`li[data-slidev-md^="${LINE[text]},"]`).dblclick(8, 8)
    cy.focused().should('have.attr', 'contenteditable', 'true').type(caret === 'end' ? '{moveToEnd}' : '{moveToStart}')
  }

  // Tab and ⌥-arrows as plain keydowns (`cy.type` has no `{tab}`).
  const key = (k: string, opts: Partial<KeyboardEventInit> = {}) => cy.focused().trigger('keydown', { key: k, ...opts })

  // `lines` replaced in the slide's original source.
  const replaced = (from: string, to: string) => original.replace(from, to)

  before(() => {
    cy.request(`${BASE}/__slidev/slides/${SLIDE}.json`).then(({ body }) => {
      original = (typeof body === 'string' ? JSON.parse(body) : body).content
    })
  })

  afterEach(() => {
    cy.request('POST', `${BASE}/__slidev/slides/${SLIDE}.json`, { content: original, skipHmr: false })
  })

  it('enter at the end adds an item and edits it; Enter on the empty item removes it', () => {
    visit()
    edit('gamma')
    cy.focused().type('{enter}')
    expectSource(replaced('- gamma\n', '- gamma\n- \n'))
    cy.focused().should('have.attr', 'contenteditable', 'true').type('delta{enter}')
    expectSource(replaced('- gamma\n', '- gamma\n- delta\n- \n'))
    cy.focused().type('{enter}')
    expectSource(replaced('- gamma\n', '- gamma\n- delta\n'))
  })

  it('enter mid-text splits an item, renumbering an ordered list', () => {
    visit()
    cy.get(`li[data-slidev-md^="${LINE.two},"]`).dblclick(8, 8)
    cy.focused().type('{moveToStart}{rightArrow}{enter}')
    expectSource(replaced('2. two\n3. three', '2. t\n3. wo\n4. three'))
  })

  it('new task items start unchecked', () => {
    visit()
    edit('done')
    cy.focused().type('{enter}')
    // Saved without its trailing space at the end of the slide. An empty task item renders as
    // the text `[ ]` (markdown-it needs text after the box), so it's edited as raw markdown.
    expectSource(replaced('- [x] done', '- [x] done\n- [ ]'))
    cy.get('.slidev-text-raw-editor').should('have.value', '').type('next{enter}')
    expectSource(replaced('- [x] done', '- [x] done\n- [ ] next'))
  })

  it('backspace at the start merges into the item above, and ⌘Z restores the source', () => {
    visit()
    edit('gamma', 'start')
    cy.focused().type('{backspace}')
    expectSource(replaced('  - beta one\n- gamma\n', '  - beta onegamma\n'))
    cy.focused().type('{esc}')
    cy.get('body').type('{cmd}z')
    expectSource(original)
  })

  it('tab nests an item with its children under the previous sibling; ⇧Tab lifts it back', () => {
    visit()
    edit('beta')
    key('Tab')
    expectSource(replaced('- beta\n  - beta one\n', '  - beta\n    - beta one\n'))
    key('Tab', { shiftKey: true })
    expectSource(original)
  })

  it('⌥↓ moves an item with its nested list below the next sibling', () => {
    visit()
    edit('beta')
    key('ArrowDown', { altKey: true })
    expectSource(replaced('- beta\n  - beta one\n- gamma\n', '- gamma\n- beta\n  - beta one\n'))
  })
})
