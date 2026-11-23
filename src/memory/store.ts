import type { Db, Queryable } from '../storage/database.js'
import type { MemoryFact, MemoryRecord } from './record.js'

/** Who changed a record: a chain session's task and machine, or nobody known (the hub's folder). */
export interface MemoryAuthor {
  task: string | null
  machine: string | null
  /** ISO */
  at: string
}

/**
 * What a versioned write did (BTN-1029): `written` — the record as kept; `changed` — the record is not at the version
 * the session read (another session changed or deleted it), `current` is what it holds now, `undefined` when it never
 * existed; `exists` — a new record was asked under a name a live record has.
 */
export type MemoryOutcome =
  | { kind: 'written'; record: MemoryRecord }
  | { kind: 'changed'; current: MemoryRecord | undefined }
  | { kind: 'exists'; current: MemoryRecord }

interface Row {
  name: string
  description: string
  type: string
  body: string
  version: number
  deleted: boolean
  file: string | null
  file_hash: string | null
  task: string | null
  machine_id: string | null
  at: string
}

const COLUMNS = 'name, description, type, body, version, deleted, file, file_hash, task, machine_id, at'

function recordOf(row: Row): MemoryRecord {
  return {
    name: row.name,
    description: row.description,
    type: row.type,
    body: row.body,
    version: Number(row.version),
    deleted: row.deleted,
    file: row.file,
    fileHash: row.file_hash,
    task: row.task,
    machine: row.machine_id,
    at: row.at,
  }
}

/** The project's records by name, deleted ones too when `withDeleted`. */
export async function memoryRecords(db: Queryable, project: string, withDeleted = false): Promise<MemoryRecord[]> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from memory_records where project_id = $1${withDeleted ? '' : ' and not deleted'} order by name`,
    [project],
  )
  return rows.map(recordOf)
}

/** The record, a deleted one too; `undefined` — it never existed. */
export async function memoryRecord(db: Queryable, project: string, name: string): Promise<MemoryRecord | undefined> {
  const { rows } = await db.query<Row>(`select ${COLUMNS} from memory_records where project_id = $1 and name = $2`, [project, name])
  return rows[0] === undefined ? undefined : recordOf(rows[0])
}

/**
 * A new record: version 1, or the next after a deleted one of the name. A live record of the name refuses it. One
 * statement, so two sessions writing at once never both win.
 */
export async function createMemory(db: Db, project: string, fact: MemoryFact, by: MemoryAuthor): Promise<MemoryOutcome> {
  const { rows } = await db.query<Row>(
    `insert into memory_records (project_id, name, description, type, body, version, deleted, task, machine_id, at)
       values ($1, $2, $3, $4, $5, 1, false, $6, $7, $8)
     on conflict (project_id, name) do update set description = excluded.description, type = excluded.type, body = excluded.body,
       version = memory_records.version + 1, deleted = false, task = excluded.task, machine_id = excluded.machine_id, at = excluded.at
       where memory_records.deleted
     returning ${COLUMNS}`,
    [project, fact.name, fact.description, fact.type, fact.body, by.task, by.machine, by.at],
  )
  if (rows[0] !== undefined) return { kind: 'written', record: recordOf(rows[0]) }
  return { kind: 'exists', current: (await memoryRecord(db, project, fact.name))! }
}

/** A change of a live record at the version the session read; any other version refuses it with what is there now. */
export async function updateMemory(db: Db, project: string, fact: MemoryFact, version: number, by: MemoryAuthor): Promise<MemoryOutcome> {
  const { rows } = await db.query<Row>(
    `update memory_records set description = $4, type = $5, body = $6, version = version + 1, task = $7, machine_id = $8, at = $9
       where project_id = $1 and name = $2 and version = $3 and not deleted
     returning ${COLUMNS}`,
    [project, fact.name, version, fact.description, fact.type, fact.body, by.task, by.machine, by.at],
  )
  if (rows[0] !== undefined) return { kind: 'written', record: recordOf(rows[0]) }
  return { kind: 'changed', current: await memoryRecord(db, project, fact.name) }
}

/** Deletes a live record at the version the session read: it stays as a mark with the next version. */
export async function deleteMemory(db: Db, project: string, name: string, version: number, by: MemoryAuthor): Promise<MemoryOutcome> {
  const { rows } = await db.query<Row>(
    `update memory_records set deleted = true, version = version + 1, task = $4, machine_id = $5, at = $6
       where project_id = $1 and name = $2 and version = $3 and not deleted
     returning ${COLUMNS}`,
    [project, name, version, by.task, by.machine, by.at],
  )
  if (rows[0] !== undefined) return { kind: 'written', record: recordOf(rows[0]) }
  return { kind: 'changed', current: await memoryRecord(db, project, name) }
}

/**
 * The fact as a file of the hub's folder holds it, whatever the record was: a hand edit wins, since the folder's owner
 * is a person; the version grows as with any change.
 */
export async function takeMemoryFile(db: Db, project: string, fact: MemoryFact, file: string, hash: string, at: string): Promise<MemoryRecord> {
  const { rows } = await db.query<Row>(
    `insert into memory_records (project_id, name, description, type, body, version, deleted, file, file_hash, task, machine_id, at)
       values ($1, $2, $3, $4, $5, 1, false, $6, $7, null, null, $8)
     on conflict (project_id, name) do update set description = excluded.description, type = excluded.type, body = excluded.body,
       version = memory_records.version + 1, deleted = false, file = excluded.file, file_hash = excluded.file_hash,
       task = null, machine_id = null, at = excluded.at
     returning ${COLUMNS}`,
    [project, fact.name, fact.description, fact.type, fact.body, file, hash, at],
  )
  return recordOf(rows[0]!)
}

/** Marks a record deleted because its file left the hub's folder. */
export async function dropMemoryFile(db: Db, project: string, name: string, at: string): Promise<void> {
  await db.query(
    `update memory_records set deleted = true, version = version + 1, file = null, file_hash = null, task = null, machine_id = null, at = $3
       where project_id = $1 and name = $2 and not deleted`,
    [project, name, at],
  )
}

/** Forgets every record's file: the project's folder is new to the mirror, so nothing was mirrored into it yet. */
export async function forgetMemoryFiles(db: Db, project: string): Promise<void> {
  await db.query('update memory_records set file = null, file_hash = null where project_id = $1', [project])
}

/** Notes the file that mirrors the record's version now; a record changed meanwhile keeps its own mark. */
export async function markMirrored(db: Db, project: string, name: string, version: number, file: string | null, hash: string | null): Promise<void> {
  await db.query('update memory_records set file = $4, file_hash = $5 where project_id = $1 and name = $2 and version = $3', [project, name, version, file, hash])
}
