/**
 * Fetch `url` until `select(body)` deep-equals `expected` (edits save asynchronously), then
 * assert it. `cy.should` doesn't await a promise its callback returns, so polling a fetch inside
 * one asserts nothing; this re-requests explicitly instead.
 */
export function expectEventually<T>(url: string, select: (body: any) => T, expected: T, tries = 60): void {
  cy.request({ url, log: false }).then(({ body }) => {
    const actual = select(typeof body === 'string' ? JSON.parse(body) : body)
    if (tries > 1 && JSON.stringify(actual) !== JSON.stringify(expected)) {
      cy.wait(100, { log: false })
      expectEventually(url, select, expected, tries - 1)
    }
    else {
      expect(actual).to.deep.eq(expected)
    }
  })
}
