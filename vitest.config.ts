import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts', 'tally/src/**/*.test.ts', 'plugins/**/*.test.mjs'],
    globalSetup: ['test/pglite-template.ts'],
    setupFiles: ['test/pglite.ts'],
    // The storage and git tests are bound by the disk more than the CPU: on a 12-core workstation half the cores ran
    // the suite in 40 s, all of them in 50 s. A CI runner keeps the default.
    maxWorkers: process.env.CI ? undefined : '50%',
  },
})
