import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type PGliteOptions } from '@electric-sql/pglite'
import { inject, vi } from 'vitest'
import { copyTemplate } from './copy-template.js'

vi.mock('../src/storage/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storage/database.js')>()
  const templates = inject('databaseTemplates')
  const dumps = new Map<string, Blob>()
  return {
    ...actual,
    openDatabase: async (dataDir: string | undefined, steps: readonly string[] = actual.STEPS) => {
      const known = steps.every((step, index) => step === actual.STEPS[index])
      const template = !known ? undefined
        : steps.length === 1 ? templates.sqlite
        : steps.length === actual.STEPS.length ? templates.current : undefined
      // Existing databases (including every frozen SQL sample) and custom steps always take the real migration path.
      if (template !== undefined && (dataDir === undefined || !existsSync(join(dataDir, 'PG_VERSION')))) {
        if (dataDir === undefined) {
          let dump = dumps.get(template.dump)
          if (dump === undefined) {
            dump = new Blob([readFileSync(template.dump)])
            dumps.set(template.dump, dump)
          }
          return PGlite.create({ loadDataDir: dump })
        }
        await copyTemplate(template, dataDir)
      }
      return actual.openDatabase(dataDir, steps)
    },
  }
})

// initdb costs about a second per new database, five times that under a full parallel run, and the storage tests make
// hundreds of them. A new database starts from the run's fresh cluster instead (`test/pglite-template.ts`): a copy of
// its folder for a database on disk, its dump for one in memory. What the code under test sees is the same.
const PATCHED = Symbol.for('even-keel.pglite-template')

if (!(PATCHED in PGlite)) {
  const template = inject('pgliteTemplate')
  const { dump } = template
  const fresh = new Blob([readFileSync(dump)])
  const create = PGlite.create.bind(PGlite)
  Object.assign(PGlite, {
    [PATCHED]: true,
    create: async (first?: string | PGliteOptions, second?: PGliteOptions) => {
      const options: PGliteOptions = typeof first === 'string' ? { ...second, dataDir: first } : { ...first }
      if (options.loadDataDir === undefined) {
        if (options.dataDir === undefined) options.loadDataDir = fresh
        else if (!existsSync(join(options.dataDir, 'PG_VERSION'))) await copyTemplate(template, options.dataDir)
      }
      return create(options)
    },
  })
}
