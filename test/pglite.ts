import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type PGliteOptions } from '@electric-sql/pglite'
import { inject } from 'vitest'

// initdb costs about a second per new database, five times that under a full parallel run, and the storage tests make
// hundreds of them. A new database starts from the run's fresh cluster instead (`test/pglite-template.ts`): a copy of
// its folder for a database on disk, its dump for one in memory. What the code under test sees is the same.
const PATCHED = Symbol.for('even-keel.pglite-template')

if (!(PATCHED in PGlite)) {
  const { dir, dump } = inject('pgliteTemplate')
  const fresh = new Blob([readFileSync(dump)])
  const create = PGlite.create.bind(PGlite)
  Object.assign(PGlite, {
    [PATCHED]: true,
    create: (first?: string | PGliteOptions, second?: PGliteOptions) => {
      const options: PGliteOptions = typeof first === 'string' ? { ...second, dataDir: first } : { ...first }
      if (options.loadDataDir === undefined) {
        if (options.dataDir === undefined) options.loadDataDir = fresh
        else if (!existsSync(join(options.dataDir, 'PG_VERSION'))) cpSync(dir, options.dataDir, { recursive: true })
      }
      return create(options)
    },
  })
}
