import { expectEventually } from '../../poll'

const BASE = Cypress.config('baseUrl')!
// The fixture slide with a collage of class-sized absolute images (`object-fit` from a `<style>`).
const SLIDE = 34

// Selecting an image hands its box to the drag editor, which writes inline geometry and a
// `clip-path`. None of that may change what's visible: for each fit, the slide must look the same
// after selecting, after a nudge there and back, and after a reload from the stored state.
context('image fit is preserved by the drag editor', () => {
  function visit() {
    // The slide at exactly 1× (980×552), on any screen: at a fractional scale, positions land on
    // fractional device pixels, and the editor's inline geometry can rasterize the picture half a
    // device pixel off from the CSS layout's.
    cy.viewport(980, 552)
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

  // A visible rectangle's edges, in CSS px relative to the slide's top-left.
  interface Rect { left: number, top: number, right: number, bottom: number }

  // The rectangles whose edges show for an image before it's selected: its box (clipping a
  // `cover` picture, or showing a `contain` box's background), and for `contain` the letterboxed
  // picture inside it.
  function visibleRects(id: string): Cypress.Chainable<{ rects: Rect[], slideWidth: number }> {
    return cy.get('#slide-content').then(($slide) => {
      const slide = $slide[0].getBoundingClientRect()
      const img = Cypress.$(`[data-testid="${id}"]`)[0] as HTMLImageElement
      const r = img.getBoundingClientRect()
      const box = { left: r.left - slide.left, top: r.top - slide.top, right: r.right - slide.left, bottom: r.bottom - slide.top }
      const rects = [box]
      const style = getComputedStyle(img)
      if (style.objectFit === 'contain') {
        const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight)
        const [w, h] = [img.naturalWidth * scale, img.naturalHeight * scale]
        const [px, py] = style.objectPosition.split(' ').map(v => Number.parseFloat(v) / 100)
        const left = box.left + (r.width - w) * px
        const top = box.top + (r.height - h) * py
        rects.push({ left, top, right: left + w, bottom: top + h })
      }
      return { rects, slideWidth: slide.width }
    })
  }

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

  // The screenshots must match pixel for pixel, except on the device pixel line each visible edge
  // falls on: the editor stores positions in whole slide px (an edge at a fractional CSS position
  // can move by half a px), and a crop's `clip-path` edge isn't snapped to device pixels the way a
  // box's own edge is. Which edges blend differently depends on the screen's scale (local runs and
  // CI differ), so every visible edge is allowed.
  function expectSame(before: string, after: string, label: string, visible: { rects: Rect[], slideWidth: number }) {
    diff(before, after).then(({ differing, width }) => {
      const k = width / visible.slideWidth
      const near = (v: number, edge: number) => Math.abs(v + 0.5 - edge * k) <= 1.5
      const within = (v: number, from: number, to: number) => v >= from * k - 1.5 && v <= to * k + 1.5
      const onEdge = ([x, y]: [number, number]) => visible.rects.some(r =>
        ((near(y, r.top) || near(y, r.bottom)) && within(x, r.left, r.right))
        || ((near(x, r.left) || near(x, r.right)) && within(y, r.top, r.bottom)))
      const elsewhere = differing.filter(p => !onEdge(p))
      cy.task('log', `${label} (×${k.toFixed(3)}): ${differing.length} pixels differ, ${elsewhere.length} off the visible edges`)
      expect(elsewhere, label).to.deep.eq([])
    })
  }

  for (const id of ['fit-cover', 'fit-contain', 'fit-fill']) {
    it(`\`${id}\`: selecting, nudging there and back, and reloading leave the slide unchanged`, () => {
      visit()
      visibleRects(id).then(visible => shot(`${id}-before`).then((before) => {
        cy.get(`[data-testid="${id}"]`).click()
        cy.get('#drag-control-container').should('have.attr', 'data-drag-id', id)
        shot(`${id}-selected`).then(selected => expectSame(before, selected, `${id} selected`, visible))

        cy.get('body').type('{leftArrow}')
        cy.get('body').type('{rightArrow}')
        shot(`${id}-nudged`).then(nudged => expectSame(before, nudged, `${id} nudged ← →`, visible))

        expectEventually(`${BASE}/__slidev/state`, (body: { state: Record<string, Record<string, unknown>> }) => body.state[String(SLIDE)]?.[id] != null, true)
        visit()
        shot(`${id}-reloaded`).then(reloaded => expectSame(before, reloaded, `${id} reloaded`, visible))
      }))
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
