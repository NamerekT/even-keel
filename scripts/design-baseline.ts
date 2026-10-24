/**
 * Writes `web/src/design-baseline.json`: how many design-rule violations (`web/src/ui/cssRules.ts`) each stylesheet of
 * `web/src` still has. `web/src/design.test.ts` fails when a file has more and asks to run this when it has fewer.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { violationCounts } from '../web/src/ui/cssRules.js'

const root = 'web/src'
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.css') ? [join(dir, entry.name)] : [],
  )
const sheets = Object.fromEntries(walk(root).map((file) => [relative(root, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')]))
const counts = violationCounts(sheets)
writeFileSync(join(root, 'design-baseline.json'), `${JSON.stringify(counts, null, 2)}\n`)
console.log(`${Object.values(counts).reduce((sum, count) => sum + count, 0)} violations in ${Object.keys(counts).length} files`)
