import { cpSync, existsSync, readdirSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import { insertList, inTransaction, openDatabase, refuseNewer, SQLITE_VERSIONS, STEPS, type Db, type Queryable } from './database.js'
import { dataDirOf, filesDirOf } from './owner.js'

/** The rows of a database, by table: what a copy carries over. */
export type Rows = Record<string, Record<string, unknown>[]>

/** The tables a copy carries over: every table but the version. */
export async function tablesOf(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' and tablename <> 'schema_version' order by tablename",
  )
  return rows.map(({ name }) => name)
}

const tableRows = (name: string) => `(select coalesce(json_agg(r), '[]'::json) from "${name}" r)`

/** Every row of every table but the version, in one statement: a consistent snapshot while the service writes. */
export async function rowsOf(db: Queryable): Promise<Rows> {
  const tables = await tablesOf(db)
  if (tables.length === 0) return {}
  const parts = tables.map((name) => `'${name}', ${tableRows(name)}`)
  const { rows } = await db.query<{ rows: Rows }>(`select json_build_object(${parts.join(', ')}) as rows`)
  return rows[0]!.rows
}

/**
 * The rows of `rowsOf` as JSON text, never parsed here: read a table a statement inside one transaction, which keeps
 * the service's writes out until the last table is read, so the snapshot stays consistent while the event loop runs
 * between the statements. For the automatic backup (`src/storage/backup.ts`), whose thread parses it.
 */
export async function rowsTextOf(db: Db): Promise<string> {
  return inTransaction(db, async (tx) => {
    const parts: string[] = []
    for (const name of await tablesOf(tx)) {
      const { rows } = await tx.query<{ rows: string }>(`select ${tableRows(name)}::text as rows`)
      parts.push(`${JSON.stringify(name)}:${rows[0]!.rows}`)
    }
    return `{${parts.join(',')}}`
  })
}

/**
 * Writes the rows into a new database in `dataDir` of the schema `steps` bring it to, then the attachments' bytes
 * `files` (the source's folder) into `filesDir`, without half-written uploads.
 */
export async function writeRows(rows: Rows, dir: string, files: string | undefined, steps: readonly string[] = STEPS): Promise<void> {
  const copy = await openDatabase(dataDirOf(dir), steps)
  try {
    await insertRows(copy, rows)
  } finally {
    await copy.close()
  }
  if (files !== undefined && existsSync(files)) cpSync(files, filesDirOf(dir), { recursive: true, filter: (path) => !/\.tmp$/.test(path) })
}

/** Inserts the rows into the tables of the same names and moves the counters of the id columns past them. */
export async function insertRows(db: Db, rows: Rows): Promise<void> {
  await inTransaction(db, async (tx) => {
    for (const [table, list] of Object.entries(rows)) await insertList(tx, table, list)
    const { rows: counters } = await tx.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and is_identity = 'YES'",
    )
    for (const { table_name, column_name } of counters) {
      await tx.query(
        `select setval(pg_get_serial_sequence('"${table_name}"', '${column_name}'), coalesce(max("${column_name}"), 0) + 1, false) from "${table_name}"`,
      )
    }
  })
}

/**
 * A copy of the database into the new folder `dir`, laid out as the database folder of the state folder: to restore it,
 * stop the service and put it in place of `state/even-keel`. The source is of this code's version (`checkVersion`).
 * `files` — the source's folder of attachments' bytes, copied after the rows: a record is written after its file, so
 * every record of the copy finds its bytes.
 */
export async function backupDatabase(source: Queryable, dir: string, files?: string): Promise<void> {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`storage: ${dir} exists; give a new folder`)
  await writeRows(await rowsOf(source), dir, files)
}

/**
 * The rows of the `node:sqlite` file of versions 1 and 2 (BTN-147), read whole; its tables are those of step 3. The
 * import (`fold`) also folds a WAL the old service left into the file, so that the file renamed to `*.imported` holds
 * everything; a reader only reads.
 */
export async function sqliteRows(file: string, fold = false): Promise<Rows> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file, { readOnly: !fold })
  try {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    refuseNewer(file, version, SQLITE_VERSIONS)
    if (fold) db.exec('PRAGMA journal_mode = DELETE')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
    return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Record<string, unknown>[]]))
  } finally {
    db.close()
  }
}

/**
 * The SQLite file's state in a database of its own in memory, of step 3 like the file's tables: for a reader that finds
 * no state database yet.
 */
export async function sqliteInMemory(file: string): Promise<PGlite> {
  const rows = await sqliteRows(file)
  const db = await openDatabase(undefined, STEPS.slice(0, 1))
  await insertRows(db, rows)
  return db
}
