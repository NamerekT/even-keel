import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fail } from '../notice/notice.js'

/** Even Keel's state database in the state folder (BTN-147). The config stays a file. */
export const DATABASE_FILE = 'even-keel.db'

const BUSY_TIMEOUT_MS = 5_000

/**
 * Numbered schema steps: STEPS[n] takes the database from version n (`PRAGMA user_version`) to n + 1, in one
 * transaction with the new version. A step is never edited or removed once merged: a schema change is a new step.
 * A project is named by its id (`projects[].id` of the config); the JSON columns hold what the code keeps as it is.
 */
export const STEPS: readonly string[] = [
  `
  CREATE TABLE chain_flags (
    name  TEXT PRIMARY KEY CHECK (name IN ('unattended', 'trimTools')),
    value TEXT NOT NULL
  );
  CREATE TABLE chains (
    position   INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    chain      TEXT NOT NULL
  );
  CREATE TABLE chain_queue (
    position   INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL
  );
  CREATE TABLE chain_lists (
    project_id TEXT NOT NULL,
    list       TEXT NOT NULL CHECK (list IN ('orders', 'skipped', 'leftovers', 'released', 'ci')),
    value      TEXT NOT NULL,
    PRIMARY KEY (project_id, list)
  );
  CREATE TABLE questions (
    position   INTEGER PRIMARY KEY,
    task       TEXT NOT NULL,
    session_id TEXT NOT NULL,
    ask        TEXT NOT NULL,
    comment    TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE launches (
    id         INTEGER PRIMARY KEY,
    at         TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task       TEXT NOT NULL,
    session_id TEXT NOT NULL,
    reason     TEXT,
    extra      TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX launches_session ON launches (session_id);
  CREATE INDEX launches_task ON launches (task);
  CREATE TABLE handoffs (
    session_id TEXT PRIMARY KEY,
    at         TEXT,
    task       TEXT,
    previous   TEXT,
    reason     TEXT,
    prompt     TEXT,
    note_path  TEXT,
    note       TEXT
  );
  CREATE TABLE closed_tasks (
    project_id TEXT NOT NULL,
    task       TEXT NOT NULL,
    tracker    TEXT NOT NULL,
    title      TEXT NOT NULL,
    url        TEXT,
    closed_at  TEXT NOT NULL,
    PRIMARY KEY (project_id, task)
  );
  `,
]

export function databaseVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

/**
 * Opens the database and brings it to the current schema; a database a newer Even Keel wrote is refused before anything
 * is written. `:memory:` is a database of its own, for tests.
 */
export function openDatabase(file: string, steps: readonly string[] = STEPS): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS })
  try {
    refuseNewerDatabase(file, db, steps.length)
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
    for (let version = databaseVersion(db); version < steps.length; version++) {
      inTransaction(db, () => {
        db.exec(steps[version]!)
        db.exec(`PRAGMA user_version = ${version + 1}`)
      })
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Opens the database only to read it, without migrating: `undefined` when there is none yet. For readers outside the
 * service (Tally), which must not write; a database of another schema than this code's is refused.
 */
export function readDatabase(file: string, known: number = STEPS.length): DatabaseSync | undefined {
  if (!existsSync(file)) return undefined
  const db = new DatabaseSync(file, { readOnly: true, timeout: BUSY_TIMEOUT_MS })
  try {
    refuseNewerDatabase(file, db, known)
    if (databaseVersion(db) < known) throw new Error(`storage: ${file} is at schema ${databaseVersion(db)}, this code reads ${known}; start the service to migrate it`)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function refuseNewerDatabase(file: string, db: DatabaseSync, known: number): void {
  const version = databaseVersion(db)
  if (version > known) throw fail('storage.newerDatabase', { file, version, known })
}

/** Runs `body` in one transaction: all of its writes or none. A call inside another one joins it. */
export function inTransaction<T>(db: DatabaseSync, body: () => T): T {
  if (db.isTransaction) return body()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = body()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
