import { defineConfig } from 'tsup'

export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm'], dts: true, clean: true, target: 'es2022' },
  { entry: ['src/cli.ts'], format: ['esm'], platform: 'node', target: 'node20' },
])
