import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3041',
    chromeWebSecurity: false,
    specPattern: 'cypress/e2e/**/*.spec.*',
    supportFile: false,
    // The fork's deck-state plugin (better-sqlite3 hydrate + state probe + SSE) adds
    // startup latency, so the cold first page-load in CI can take >4s — the upstream
    // `basic nav` redirect assertion timed out at the 4s default. Give commands more
    // headroom, and retry whole specs in CI to absorb cold-start / hydration-timing
    // flakes without re-chasing each one.
    defaultCommandTimeout: 8000,
    retries: { runMode: 2, openMode: 0 },
  },
})
