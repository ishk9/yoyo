import { defineConfig } from '@playwright/test'

// BUNDLER=webpack runs the same spec against `next dev --webpack`.
const webpack = process.env.BUNDLER === 'webpack'
const port = webpack ? 3101 : 3100

export default defineConfig({
  testDir: 'e2e',
  workers: 1, // specs edit example files on disk to trigger real HMR
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1000, height: 700 } },
  webServer: {
    command: `pnpm --filter next-app exec next dev -p ${port}${webpack ? ' --webpack' : ''}`,
    env: { NODE_ENV: 'development' }, // a stray NODE_ENV=production breaks webpack's CSS pipeline in dev
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
