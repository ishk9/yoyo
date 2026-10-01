import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environmentOptions: { jsdom: { url: 'http://localhost:3000/' } } },
})
