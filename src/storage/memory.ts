import type { PGlite } from '@electric-sql/pglite'
import { onTestFinished } from 'vitest'
import { openDatabase } from './database.js'

let template: Promise<PGlite> | undefined

/**
 * A database of the current schema in memory, for tests: a clone of one migrated once per test file, closed when the
 * test ends. Each clone holds a few hundred MB of WASM memory: left open, one file's clones got its worker killed by
 * the 5 GB limit of the CI runner.
 */
export async function memoryDatabase(): Promise<PGlite> {
  template ??= openDatabase(undefined)
  const db = (await (await template).clone()) as PGlite
  onTestFinished(async () => {
    if (!db.closed) await db.close()
  })
  return db
}
