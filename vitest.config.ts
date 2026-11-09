import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts', 'tally/src/**/*.test.ts', 'plugins/**/*.test.mjs', 'scripts/**/*.test.ts', 'deploy/*/src/**/*.test.ts'],
    globalSetup: ['test/pglite-template.ts'],
    setupFiles: ['test/pglite.ts'],
    // On a 12-core workstation half the cores run `npm test` in 105 s; all of them in 90 s, but then tests that wait on
    // a child process (the SDK executor's socket, the CLI samples, a plugin hook) time out (2026-11-02). A CI runner keeps the default.
    maxWorkers: process.env.CI ? undefined : '50%',
    // Vitest empties every stylesheet by default, `?raw` too; the design test (`web/src/design.test.ts`) reads them raw.
    css: { include: [/\.css\?raw$/] },
  },
})
