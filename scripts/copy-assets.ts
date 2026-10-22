/**
 * The build's last step: what `tsc` does not emit and the compiled code reads next to itself — Tally's SQL steps
 * (`tally/src/migrations.ts` reads them by `import.meta.url`). The npm package runs only from `dist/` (BTN-265).
 */
import { cpSync, statSync } from 'node:fs'

cpSync('tally/src', 'dist/tally/src', { recursive: true, filter: (path) => statSync(path).isDirectory() || path.endsWith('.sql') })
