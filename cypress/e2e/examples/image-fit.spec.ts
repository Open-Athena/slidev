import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
// The fixture slide with a collage of class-sized absolute images (`object-fit` from a `<style>`).
const SLIDE = 34

// Selecting an image hands its box to the drag editor, which writes inline geometry and a
// `clip-path`. None of that may change what's visible: for each fit, the slide must look the same
// after selecting, after a nudge there and back, and after a reload from the stored state.
context('image fit is preserved by the drag editor', () => {
  function visit() {
    cy.visit(`${BASE}/${SLIDE}`, {
      onBeforeLoad: win => win.localStorage.setItem('slidev-edit-mode', 'true'),
    }).wait(500)
    cy.get('#slide-content').should($slide => expect($slide[0].getBoundingClientRect().width).to.be.greaterThan(100))
    for (const id of ['fit-cover', 'fit-contain', 'fit-fill'])
      cy.get(`[data-testid="${id}"]`).should($img => expect(($img[0] as HTMLImageElement).naturalWidth).to.eq(400))
    // The selection outline and handles aren't part of the slide's look.
    cy.document().then((doc) => {
      const style = doc.createElement('style')
      style.textContent = '#drag-control-container, #group-drag-control-container { visibility: hidden !important; }'
      doc.head.append(style)
    })
  }

  function shot(name: string): Cypress.Chainable<string> {
    let path = ''
    return cy.get('#slide-content')
      .screenshot(name, { overwrite: true, onAfterScreenshot: (_el, props) => { path = props.path } })
      .then(() => cy.readFile(path, 'base64'))
  }

  async function pixels(base64: string): Promise<ImageData> {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return ctx.getImageData(0, 0, img.width, img.height)
  }

  // A horizontal edge of a visible box, in slide px: `y`, spanning `x0`–`x1`.
  interface Edge { y: number, x0: number, x1: number }

  // Pixels (device px of the screenshot) whose color differs in any channel.
  function diff(a: string, b: string): Cypress.Chainable<{ differing: Array<[number, number]>, width: number }> {
    return cy.wrap(Promise.all([pixels(a), pixels(b)]).then(([pa, pb]) => {
      expect([pa.width, pa.height]).to.deep.eq([pb.width, pb.height])
      const differing: Array<[number, number]> = []
      for (let i = 0; i < pa.data.length; i += 4) {
        if (pa.data[i] !== pb.data[i] || pa.data[i + 1] !== pb.data[i + 1] || pa.data[i + 2] !== pb.data[i + 2])
          differing.push([(i / 4) % pa.width, Math.floor(i / 4 / pa.width)])
      }
      return { differing, width: pa.width }
    }), { log: false })
  }

  // The screenshots must match pixel for pixel, except for anti-aliasing on `edges`: a crop's
  // `clip-path` edge isn't snapped to device pixels the way a box's own edge is, so the one device
  // pixel row it falls in blends differently.
  function expectSame(before: string, after: string, label: string, edges: Edge[] = []) {
    diff(before, after).then(({ differing, width }) => {
      const k = width / 980
      const onEdge = ([x, y]: [number, number]) => edges.some(e =>
        Math.abs(y + 0.5 - e.y * k) <= 1 && x >= e.x0 * k - 1 && x <= e.x1 * k + 1)
      const elsewhere = differing.filter(p => !onEdge(p))
      cy.task('log', `${label}: ${differing.length} pixels differ, ${elsewhere.length} off the crop edges`)
      expect(elsewhere, label).to.deep.eq([])
    })
  }

  // The cover image's visible box (`.fit-cover` in the collage at (60, 110)): its top and bottom
  // edges are where the editor's crop clips the picture.
  const coverEdges: Edge[] = [{ y: 300, x0: 60, x1: 404 }, { y: 490, x0: 60, x1: 404 }]
  const edgesOf: Record<string, Edge[]> = { 'fit-cover': coverEdges, 'fit-contain': [], 'fit-fill': [] }

  for (const id of ['fit-cover', 'fit-contain', 'fit-fill']) {
    it(`\`${id}\`: selecting, nudging there and back, and reloading leave the slide unchanged`, () => {
      visit()
      shot(`${id}-before`).then((before) => {
        cy.get(`[data-testid="${id}"]`).click()
        cy.get('#drag-control-container').should('have.attr', 'data-drag-id', id)
        shot(`${id}-selected`).then(selected => expectSame(before, selected, `${id} selected`, edgesOf[id]))

        cy.get('body').type('{leftArrow}')
        cy.get('body').type('{rightArrow}')
        shot(`${id}-nudged`).then(nudged => expectSame(before, nudged, `${id} nudged ← →`, edgesOf[id]))

        expectEventually(`${BASE}/__slidev/state`, (body: { state: Record<string, Record<string, unknown>> }) => body.state[String(SLIDE)]?.[id] != null, true)
        visit()
        shot(`${id}-reloaded`).then(reloaded => expectSame(before, reloaded, `${id} reloaded`, edgesOf[id]))
      })
    })
  }

  it('`fit-cover`: the editor\'s box is the whole picture, cropped to what the CSS showed', () => {
    visit()
    cy.get('#slide-content').then(($slide) => {
      const scale = $slide[0].getBoundingClientRect().width / 980
      cy.get('[data-testid="fit-cover"]').click()
      // 400×300 covering 344×190 with `object-position: 0 25%`: 344×258, 17px of it above the box.
      cy.get('[data-testid="fit-cover"]').should(($img) => {
        const rect = $img[0].getBoundingClientRect()
        expect(rect.width / scale).to.be.closeTo(344, 0.5)
        expect(rect.height / scale).to.be.closeTo(258, 0.5)
        expect($img[0].style.clipPath).to.eq('inset(6.58915% 0% 19.7674%)')
      })
    })
  })
})
