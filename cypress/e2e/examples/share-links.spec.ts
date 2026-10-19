export {}

// "Get link" (specs/share-links.md). The fixture dev server runs with `SLIDEV_AUTH_UI=1` (its
// `dev` script), which turns the share UI's `whoami` probe on without a gate; it has no auth
// routes, so every `api/auth/*` answer here is stubbed. Never the real clipboard: it's stubbed.

const BASE = Cypress.config('baseUrl')!
const waitForSlide = () => cy.get('#slide-content', { timeout: 30000 }).should($s => expect($s[0].getBoundingClientRect().width).to.be.greaterThan(100))

const ADMIN = { kind: 'sso', email: 'boss@example.org', admin: true, scopes: ['*'], subject: null }
const STAFF = { kind: 'sso', email: 'alice@openathena.ai', admin: false, scopes: ['deck'], subject: null }

function grant(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: null,
    note: null,
    subject: null,
    email: null,
    scopes: ['deck'],
    maxRedeems: null,
    redeems: 0,
    expiresAt: null,
    sessionTtlS: null,
    createdAt: 1790000000,
    createdBy: 'boss@example.org',
    disabledAt: null,
    revokedAt: null,
    expiryEndsSessions: true,
    sessionsInvalidBefore: null,
    firstUsedAt: null,
    lastUsedAt: null,
    ...over,
  }
}

function visitAs(whoami: object | null, path = '/3') {
  cy.intercept('GET', '/api/auth/whoami', whoami ? { body: whoami } : { statusCode: 401, body: { error: 'unauthenticated' } }).as('whoami')
  cy.visit(`${BASE}${path}`, {
    onBeforeLoad(win) {
      cy.stub(win.navigator.clipboard, 'writeText').as('clipboard').resolves()
    },
  })
  waitForSlide()
  cy.wait('@whoami')
}

const shareButton = () => cy.get('[data-testid="share-link"]')

context('share links', () => {
  it('offers "Get link" to admins only', () => {
    visitAs(null)
    // Give the (stubbed) probe's answer time to land before asserting absence.
    cy.wait(300)
    shareButton().should('not.exist')
    cy.get('body').type('{shift}Y')
    cy.get('[data-share-dialog]').should('not.exist')

    visitAs(STAFF)
    cy.wait(300)
    shareButton().should('not.exist')

    visitAs(ADMIN)
    shareButton().should('exist')
  })

  it('mints a link that opens at this slide, with a copy button and its QR', () => {
    cy.intercept('POST', '/api/auth/grants', { body: { grant: grant('g1', { subject: { name: 'Rae' }, note: 'review' }), token: 'tok123' } }).as('mint')
    visitAs(ADMIN, '/3?m=heatmap')
    cy.get('body').type('{shift}Y')
    cy.get('[data-share-dialog]').should('be.visible')
    cy.get('[data-share-name]').type('Rae')
    cy.get('[data-share-note]').type('review')
    cy.get('[data-share-days]').clear().type('7')
    cy.get('[data-share-mint]').click()
    cy.wait('@mint').its('request.body').should('deep.eq', {
      scopes: ['deck'],
      subjectName: 'Rae',
      email: null,
      note: 'review',
      avatar: null,
      maxRedeems: null,
      expiresInS: 7 * 86400,
      allowlist: false,
    })
    // The fixture deck pins `publish.canonicalForm: n`; the slide's query is kept.
    cy.get('[data-share-url]').should('have.value', `${BASE}/3?m=heatmap&key=tok123`)
    cy.get('[data-share-qr] svg').should('have.length', 1)
    cy.get('[data-share-copy]').click()
    cy.get('@clipboard').should('have.been.calledOnceWith', `${BASE}/3?m=heatmap&key=tok123`)
    cy.get('.slidev-notice').should('have.text', 'Link copied')
  })

  it('mints a link to the deck\'s start, with an email and a use cap', () => {
    cy.intercept('POST', '/api/auth/grants', { body: { grant: grant('g2', { email: 'rae@example.org' }), token: 'tok456' } }).as('mint')
    visitAs(ADMIN, '/5')
    shareButton().click({ force: true })
    cy.get('[data-share-lands="start"]').check()
    cy.get('[data-share-email]').type('Rae@Example.org')
    cy.get('[data-share-days]').clear()
    cy.get('[data-share-unlimited]').uncheck()
    cy.get('[data-share-max-uses]').clear().type('2')
    cy.get('[data-share-mint]').click()
    cy.wait('@mint').its('request.body').should('deep.eq', {
      scopes: ['deck'],
      subjectName: null,
      email: 'rae@example.org',
      note: null,
      avatar: null,
      maxRedeems: 2,
      expiresInS: null,
      allowlist: true,
    })
    cy.get('[data-share-url]').should('have.value', `${BASE}/?key=tok456`)
  })

  it('lists links, edits a note, and revokes one', () => {
    let revoked = false
    cy.intercept('GET', '/api/auth/grants', (req) => {
      req.reply({
        body: {
          grants: [
            grant('g1', { subject: { name: 'Rae' }, note: 'review', redeems: 2, revokedAt: revoked ? 1790000500 : null }),
            grant('g0', { email: 'old@example.org', revokedAt: 1789000000, createdAt: 1789000000 }),
          ],
        },
      })
    }).as('list')
    cy.intercept('PATCH', '/api/auth/grants/g1', { body: { grant: grant('g1', { subject: { name: 'Rae' }, note: 'board review', redeems: 2 }) } }).as('patch')
    cy.intercept('POST', '/api/auth/grants/g1/revoke', (req) => {
      revoked = true
      req.reply({ body: { ok: true } })
    }).as('revoke')
    visitAs(ADMIN)
    cy.window().then(win => cy.stub(win, 'confirm').returns(true))
    cy.get('body').type('{shift}Y')
    cy.get('[data-share-tab="links"]').click()
    cy.wait('@list')
    const rows = () => cy.get('[data-share-links] tbody tr[data-share-link]')
    const cells = () => rows().then($r => $r.toArray().map(r => ['holder', 'note', 'uses'].map(c => r.querySelector(`[data-col="${c}"]`)!.textContent!.trim())))
    // Revoked links are hidden until asked for.
    cells().should('deep.eq', [['Rae', 'review', '2']])
    cy.get('[data-share-show-revoked]').check()
    cells().should('deep.eq', [['Rae', 'review', '2'], ['old@example.org', '—', '0']])
    cy.get('[data-share-show-revoked]').uncheck()

    cy.get('[data-share-link="g1"] [data-col="note"] button').click()
    cy.get('[data-share-edit-note]').clear().type('board review{enter}')
    cy.wait('@patch').its('request.body').should('deep.eq', { note: 'board review' })
    cells().should('deep.eq', [['Rae', 'board review', '2']])

    cy.get('[data-share-link="g1"] [data-share-revoke]').click()
    cy.wait('@revoke')
    cy.wait('@list')
    cy.get('[data-share-empty]').should('have.text', 'No active links.')
    cy.get('[data-share-show-revoked]').check()
    cy.get('[data-share-link="g1"] [data-share-revoked]').should('have.text', 'revoked')
  })
})
