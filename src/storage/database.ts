import { mkdirSync } from 'node:fs'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { fail } from '../notice/notice.js'
import { STEPS } from './database-steps.js'

/** Even Keel's state database: a PGlite folder in the state folder (BTN-198), `pgdata/` and `owner.json` inside. */
export const DATABASE_DIR = 'even-keel'

/** Versions 1 and 2 were the `node:sqlite` file `even-keel.db` of the state folder, imported once (`src/storage/copy.ts`). */
export const SQLITE_FILE = 'even-keel.db'
export const SQLITE_VERSIONS = 2

/** A database or one of its transactions: what writes take. */
export type Db = PGlite | Transaction

/** What reads take: the service's own database, a transaction, or a client of its socket (`src/storage/owner.ts`). */
export interface Queryable {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>
}

export { STEPS } from './database-steps.js'

/** The version this code reads and writes. */
export const DATABASE_VERSION = SQLITE_VERSIONS + STEPS.length

const VERSION_TABLE = `
  create table schema_version (
    only_row    boolean primary key default true check (only_row),
    version     integer not null,
    migrated_at timestamptz not null default now()
  )`

/** 0 — an empty database. */
export async function databaseVersion(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ present: boolean }>(`select to_regclass('schema_version') is not null as present`)
  if (rows[0]?.present !== true) return 0
  const found = await db.query<{ version: number }>('select version from schema_version')
  return Number(found.rows[0]?.version ?? 0)
}

/**
 * Opens the database in `dataDir` (in memory without one, for tests) and brings it to the current schema; a database a
 * newer Even Keel wrote is refused before anything is written. One process holds the folder: `src/storage/owner.ts`.
 * `before` runs when an existing database is about to take new steps, on its schema `from` (the backup's copy, BTN-1083).
 */
export async function openDatabase(dataDir: string | undefined, steps: readonly string[] = STEPS, before?: BeforeSteps): Promise<PGlite> {
  if (dataDir !== undefined) mkdirSync(dataDir, { recursive: true })
  const db = await PGlite.create(dataDir === undefined ? {} : { dataDir })
  try {
    await migrateDatabase(db, dataDir ?? 'memory', steps, before)
    return db
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}

export type BeforeSteps = (db: PGlite, from: number) => Promise<void>

async function migrateDatabase(db: PGlite, where: string, steps: readonly string[], before?: BeforeSteps): Promise<void> {
  const known = SQLITE_VERSIONS + steps.length
  const from = await databaseVersion(db)
  refuseNewer(where, from, known)
  if (before !== undefined && from > SQLITE_VERSIONS && from < known) await before(db, from)
  for (let version = Math.max(from, SQLITE_VERSIONS); version < known; version++) {
    await db.transaction(async (tx) => {
      await tx.query("select set_config('even_keel.migration_from', $1, true)", [String(from)])
      if (version === SQLITE_VERSIONS && from === 0) {
        await tx.exec(VERSION_TABLE)
        await tx.query('insert into schema_version (version) values (0)')
      }
      await tx.exec(steps[version - SQLITE_VERSIONS]!)
      await tx.query('update schema_version set version = $1, migrated_at = now()', [version + 1])
    })
  }
}

/** A reader outside the service neither migrates nor reads a database of another version than this code's. */
export async function checkVersion(db: Queryable, where: string, known: number = DATABASE_VERSION): Promise<void> {
  const version = await databaseVersion(db)
  refuseNewer(where, version, known)
  if (version < known) throw new Error(`storage: ${where} is at schema ${version}, this code reads ${known}; start the service to migrate it`)
}

export function refuseNewer(where: string, version: number, known: number): void {
  if (version > known) throw fail('storage.newerDatabase', { file: where, version, known })
}

/** Inserts the rows, named by column, into the table in one statement. */
export async function insertList(db: Db, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return
  await db.query(`insert into "${table}" select * from json_populate_recordset(null::"${table}", $1)`, [JSON.stringify(rows)])
}

/**
 * Makes the table hold exactly `rows`, in one statement, touching only what differs: a row whose `values` changed
 * is updated, a key that is gone deleted, a new one inserted. A delete and an insert of the whole table left every
 * row dead at every save (BTN-952). `keys` are the primary key's columns, `values` the rest.
 */
export async function replaceRows(db: Db, table: string, keys: string[], values: string[], rows: Record<string, unknown>[]): Promise<void> {
  const list = (columns: string[], of: string) => columns.map((column) => `${of}."${column}"`).join(', ')
  const assigned = values.map((column) => `"${column}" = excluded."${column}"`).join(', ')
  await db.query(
    `with fresh as (select * from json_populate_recordset(null::"${table}", $1)),
          gone as (delete from "${table}" old where not exists (select 1 from fresh where (${list(keys, 'fresh')}) = (${list(keys, 'old')})))
     insert into "${table}" as kept select * from fresh
       on conflict (${keys.map((key) => `"${key}"`).join(', ')}) do update set ${assigned}
       where (${list(values, 'kept')}) is distinct from (${list(values, 'excluded')})`,
    [JSON.stringify(rows)],
  )
}

/** Runs `body` in one transaction: all of its writes or none. A call inside another one joins it. */
export function inTransaction<T>(db: Db, body: (tx: Transaction) => Promise<T>): Promise<T> {
  return 'transaction' in db ? db.transaction(body) : body(db)
}

/**
 * The writes the service does not wait for. PGlite runs queries and transactions in the order they were called, so a
 * write must start its first query at the call, with no `await` before it; a failure is logged, `settled` waits for all.
 */
export class Writes {
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly log: (line: string) => void) {}

  add(what: string, write: Promise<unknown>): void {
    const tracked: Promise<void> = write.then(
      () => {
        this.pending.delete(tracked)
      },
      (error: unknown) => {
        this.pending.delete(tracked)
        this.log(`storage: ${what} not saved: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
    this.pending.add(tracked)
  }

  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }
}
