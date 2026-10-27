import type { PGlite } from '@electric-sql/pglite'
import { onTestFinished } from 'vitest'
import { openDatabase } from './database.js'

/**
 * A database of the current schema in memory, for tests: a copy of the run's migrated template, closed when the
 * test ends. Each clone holds a few hundred MB of WASM memory: left open, one file's clones got its worker killed by
 * the 5 GB limit of the CI runner.
 */
export async function memoryDatabase(): Promise<PGlite> {
  const db = await openDatabase(undefined)
  onTestFinished(async () => {
    if (!db.closed) await db.close()
  })
  return db
}
