/**
 * Writes the baselines of `web/src/design.test.ts`: `web/src/design-baseline.json`, how many design-rule violations
 * (`web/src/ui/cssRules.ts`) each stylesheet of `web/src` still has, and `web/src/glue-baseline.json`, how many facts each
 * file still glues with `·` (`web/src/ui/glueRules.ts`), and `web/src/note-baseline.json`, how many notes and hints under
 * fields each file still has (`web/src/ui/noteRules.ts`), and `web/src/row-baseline.json`, how many settings each file
 * still lays out with the control at the right of the name (`web/src/ui/rowRules.ts`). The test fails when a file has
 * more and asks to run this when it has fewer.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { violationCounts } from '../web/src/ui/cssRules.js'
import { glueCounts, glueScanned } from '../web/src/ui/glueRules.js'
import { noteCounts, noteScanned } from '../web/src/ui/noteRules.js'
import { rowCounts, rowScanned } from '../web/src/ui/rowRules.js'

const root = 'web/src'
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
const files = Object.fromEntries(walk(root).map((file) => [relative(root, file).replaceAll('\\', '/'), file]))
const read = (filter: (path: string) => boolean) =>
  Object.fromEntries(Object.keys(files).filter(filter).map((path) => [path, readFileSync(files[path]!, 'utf8')]))
const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0)

const violations = violationCounts(read((path) => path.endsWith('.css')))
writeFileSync(join(root, 'design-baseline.json'), `${JSON.stringify(violations, null, 2)}\n`)
console.log(`${sum(violations)} violations in ${Object.keys(violations).length} files`)

const glued = glueCounts(read(glueScanned))
writeFileSync(join(root, 'glue-baseline.json'), `${JSON.stringify(glued, null, 2)}\n`)
console.log(`${sum(glued)} glued dots in ${Object.keys(glued).length} files`)

const notes = noteCounts(read(noteScanned))
writeFileSync(join(root, 'note-baseline.json'), `${JSON.stringify(notes, null, 2)}\n`)
console.log(`${sum(notes)} notes under fields in ${Object.keys(notes).length} files`)

const rows = rowCounts(read(rowScanned))
writeFileSync(join(root, 'row-baseline.json'), `${JSON.stringify(rows, null, 2)}\n`)
console.log(`${sum(rows)} settings with the control at the right of the name in ${Object.keys(rows).length} files`)
