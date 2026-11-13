import { createHash } from 'node:crypto'
import { createReadStream, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { PGlite } from '@electric-sql/pglite'
import { tablesOf, writeRows, type Rows } from './copy.js'
import { databaseVersion, SQLITE_VERSIONS, STEPS } from './database.js'
import { dataDirOf, filesDirOf } from './owner.js'

// The automatic copies of the state database (BTN-1083): each written, opened back in a temporary folder and checked
// before it counts. `docs/storage.md`, "Backup, export, rollback".

/** The folder of the automatic copies when the setting `backup.dir` names none: `backups/` next to the database's folder. */
export const backupDirOf = (stateDir: string, setting: string | null) => setting ?? join(stateDir, 'backups')

export const DEFAULT_BACKUP_KEEP = 14
export const MAX_BACKUP_KEEP = 365

/** What the check of a copy found, kept in the copy as `check.json`: a copy without it is no checked copy. */
export interface CopyCheck {
  at: string
  /** The schema version of the copy. */
  version: number
  /** The rows of each table. */
  tables: Record<string, number>
  /** The attachments' files whose bytes were hashed. */
  files: number
}

export const CHECK_FILE = 'check.json'

const OWN_NAME = /^even-keel-auto-\d{8}-\d{6}-v\d+$/

/** The name of an automatic copy: only folders of this pattern are ever rotated, never a copy made by hand. */
export function ownName(at: Date, version: number): string {
  const iso = at.toISOString()
  return `even-keel-auto-${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}-v${version}`
}

/** A copy of the database to write, sent to the backup's thread. */
export interface CopyJob {
  /** The rows as `rowsTextOf` read them. */
  rows: string
  /** The source's schema version: the copy is made at it. */
  version: number
  /** The copy's new folder. */
  dir: string
  /** The source's attachments' folder. */
  files?: string
  /** The trial restore's folder, made and removed by the check; a fresh temporary one by default. */
  temp?: string
}

/** A failed copy: `copy` — writing it, `check` — it was written but did not open back whole. */
export class BackupError extends Error {
  constructor(
    readonly stage: 'copy' | 'check',
    message: string,
  ) {
    super(message)
  }
}

/** Writes the copy, checks it and marks it checked; the copy's folder goes on any failure. */
export async function makeCopy(job: CopyJob): Promise<CopyCheck> {
  if (existsSync(job.dir)) throw new BackupError('copy', `${job.dir} exists`)
  let tables: Record<string, number>
  try {
    const rows = JSON.parse(job.rows) as Rows
    tables = Object.fromEntries(Object.entries(rows).map(([table, list]) => [table, list.length]))
    await writeRows(rows, job.dir, job.files, STEPS.slice(0, job.version - SQLITE_VERSIONS))
  } catch (error) {
    rmSync(job.dir, { recursive: true, force: true })
    throw new BackupError('copy', messageOf(error))
  }
  try {
    const check = await checkCopy(job.dir, job.version, tables, job.temp)
    writeFileSync(join(job.dir, CHECK_FILE), `${JSON.stringify(check, null, 2)}\n`)
    return check
  } catch (error) {
    rmSync(job.dir, { recursive: true, force: true })
    throw new BackupError('check', messageOf(error))
  }
}

/**
 * A trial restore: the copy is copied whole into a temporary folder and opened there as the service would open it.
 * Its schema must be `version`, its tables those of `tables` with as many rows, and each `builtin_files` record must
 * find its file with the same sha256. The temporary folder goes either way.
 */
export async function checkCopy(dir: string, version: number, tables: Record<string, number>, temp?: string): Promise<CopyCheck> {
  const trial = temp ?? mkdtempSync(join(tmpdir(), 'even-keel-check-'))
  try {
    cpSync(dir, trial, { recursive: true })
    const db = await PGlite.create({ dataDir: dataDirOf(trial) })
    try {
      const found = await databaseVersion(db)
      if (found !== version) throw new Error(`the copy is at schema ${found}, not ${version}`)
      const counted: Record<string, number> = {}
      for (const name of await tablesOf(db)) {
        const { rows } = await db.query<{ count: number }>(`select count(*)::int as count from "${name}"`)
        counted[name] = rows[0]!.count
      }
      const differ = [...new Set([...Object.keys(tables), ...Object.keys(counted)])].filter((name) => tables[name] !== counted[name])
      if (differ.length > 0) {
        throw new Error(`rows differ: ${differ.map((name) => `${name} has ${counted[name] ?? 'no table'} of ${tables[name] ?? 'none'}`).join(', ')}`)
      }
      const files = Object.hasOwn(counted, 'builtin_files') ? await checkFiles(db, filesDirOf(trial)) : 0
      return { at: new Date().toISOString(), version, tables: counted, files }
    } finally {
      await db.close()
    }
  } finally {
    rmSync(trial, { recursive: true, force: true })
  }
}

async function checkFiles(db: PGlite, dir: string): Promise<number> {
  const { rows } = await db.query<{ sha256: string }>('select distinct sha256 from builtin_files order by sha256')
  const bad: string[] = []
  for (const { sha256 } of rows) {
    const path = join(dir, sha256)
    if (!existsSync(path)) bad.push(`${sha256} is missing`)
    else if ((await hashOf(path)) !== sha256) bad.push(`${sha256} has other bytes`)
  }
  if (bad.length > 0) throw new Error(`attachments: ${bad.join(', ')}`)
  return rows.length
}

async function hashOf(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** An automatic copy in the backup folder; `check` — `null` while unchecked: failed half-way, or still being written. */
export interface OwnCopy {
  name: string
  path: string
  check: CopyCheck | null
}

/** The automatic copies of the folder, oldest first; folders of other names are no copies of ours. */
export function ownCopies(dir: string): OwnCopy[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && OWN_NAME.test(entry.name))
    .map((entry) => ({ name: entry.name, path: join(dir, entry.name), check: checkOf(join(dir, entry.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function checkOf(path: string): CopyCheck | null {
  try {
    const parsed = JSON.parse(readFileSync(join(path, CHECK_FILE), 'utf8')) as Partial<CopyCheck>
    return typeof parsed.at === 'string' && typeof parsed.version === 'number' ? (parsed as CopyCheck) : null
  } catch {
    return null
  }
}

/** The newest checked copy of the folder; `null` — none. */
export const lastChecked = (dir: string): OwnCopy | null => ownCopies(dir).findLast((copy) => copy.check !== null) ?? null

/**
 * Keeps the newest `keep` checked copies: older checked ones go, and so do unchecked ones older than the newest checked
 * (a copy a crash cut short). Without a checked copy nothing goes. Returns the names removed.
 */
export function rotate(dir: string, keep: number): string[] {
  const copies = ownCopies(dir)
  const checked = copies.filter((copy) => copy.check !== null)
  const newest = checked.at(-1)
  if (newest === undefined) return []
  const gone = [...checked.slice(0, Math.max(0, checked.length - keep)), ...copies.filter((copy) => copy.check === null && copy.name < newest.name)]
  for (const copy of gone) rmSync(copy.path, { recursive: true, force: true })
  return gone.map((copy) => copy.name).sort()
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
