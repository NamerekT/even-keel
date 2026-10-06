import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts', 'tally/src/**/*.test.ts', 'plugins/**/*.test.mjs'],
  },
})
