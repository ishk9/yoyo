import { defineConfig } from 'tsup'

export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm'], dts: true, clean: true, target: 'es2022' },
  // capture() as a plain script the CLI injects into the page it loads
  { entry: { capture: 'src/snapshot.ts' }, format: ['iife'], globalName: 'yoyoCapture', target: 'es2022' },
  { entry: ['src/cli.ts'], format: ['esm'], platform: 'node', target: 'node20', external: ['playwright-core'] },
])
