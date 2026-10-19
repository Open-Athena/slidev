import { defineConfig } from 'tsdown'

// The deploy-target Worker runtime (`node/worker/index.ts`: `runtime.ts` + `auth.ts`), built on
// its own so it comes out as one self-contained module with no chunks shared with the CLI.
// `slidev build --worker` copies it next to the deck's build output.
export default defineConfig({
  entry: { 'og-worker': 'node/worker/index.ts' },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: false,
  // `dist/` is the CLI build's, which runs first and cleans it.
  clean: false,
})
