// Autosave commits edits to the deck's `slides.coords.yaml`, which would then outlive the run (the
// fixture deck's `.slidev/` state is reset per run, the YAML isn't) and take precedence over the
// fixture's inline `dragPos`. Specs that test it turn it back on.
Cypress.on('window:before:load', (win) => {
  if (win.localStorage.getItem('slidev-autosave') == null)
    win.localStorage.setItem('slidev-autosave', 'false')
})
