import type { PGlite } from '@electric-sql/pglite'
import { openDatabase } from './database.js'

let template: Promise<PGlite> | undefined

/** A database of the current schema in memory, for tests: a clone of one migrated once per test file. */
export async function memoryDatabase(): Promise<PGlite> {
  template ??= openDatabase(undefined)
  return (await (await template).clone()) as PGlite
}
