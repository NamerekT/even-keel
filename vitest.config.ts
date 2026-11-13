import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'
import { LastRunReporter } from './scripts/vitest-last-run.js'
import { excludedEndToEnd } from './scripts/vitest-scope.js'

export default defineConfig(({ mode }) => ({
  // The badge's Worker tests the drawing of this checkout, not the published package (docs/badge.md, "The Worker").
  resolve: { alias: [{ find: /^even-keel-badge$/, replacement: fileURLToPath(new URL('src/badge/drawing.ts', import.meta.url)) }] },
  test: {
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts', 'tally/src/**/*.test.ts', 'plugins/**/*.test.mjs', 'scripts/**/*.test.ts', 'deploy/*/src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...excludedEndToEnd(process.argv.slice(2), mode)],
    // The failed tests' names as the last lines and `.temp/vitest-last.json`, beside vitest's own reporters (docs/chain/e2e.md).
    reporters: [...configDefaults.reporters, new LastRunReporter()],
    globalSetup: ['test/pglite-template.ts'],
    setupFiles: ['test/pglite.ts'],
    // On a 12-core workstation half the cores run `npm test` in 105 s; all of them in 90 s, but then tests that wait on
    // a child process (the SDK executor's socket, the CLI samples, a plugin hook) time out (2026-11-02). A CI runner keeps the default.
    maxWorkers: process.env.CI ? undefined : '50%',
    // Vitest empties every stylesheet by default, `?raw` too; the design test (`web/src/design.test.ts`) reads them raw.
    css: { include: [/\.css\?raw$/] },
  },
}))
