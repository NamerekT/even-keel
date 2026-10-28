import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Transaction } from '@electric-sql/pglite'
import type { LaunchEntry } from '../chain/model.js'
import { readSnapshots, saveSnapshot, type HandoffSnapshot } from '../chain/snapshots.js'
import { appendLaunch, chainStateOf, loadChainState, loadQuestions, readLaunches, saveQuestions, writeChainRecord } from '../chain/store.js'
import { fail } from '../notice/notice.js'
import type { PostedQuestion } from '../tracker/questions.js'
import { writeAtomic } from './atomic.js'
import { insertRows, sqliteRows, type Rows } from './copy.js'
import { mirrorDefinitions, putSettings } from '../settings/store.js'
import { inTransaction, openDatabase, SQLITE_FILE, STEPS, type Db, type Queryable } from './database.js'
import { databaseDirOf, databaseExists, dataDirOf, openStateDatabase, type StateDatabase } from './owner.js'
import { isRecord } from './projects.js'
import { isVersionLine, refuseNewer, SCHEMA_VERSION, versionOf } from './schema.js'

/** The files of `state/` that v0.1 kept and the database holds now; `handoffs` is a folder of `<session id>.json`. */
export const STATE_FILES = { chain: 'chain.json', questions: 'questions.json', launches: 'launches.jsonl', handoffs: 'handoffs' } as const

/** An imported file or folder stays next to the database under its name with this suffix. */
export const IMPORTED_SUFFIX = '.imported'

export interface PrepareOptions {
  stateDir: string
  log: (line: string) => void
  /** Runs inside the import's transaction after the last insert; a test throws there to break it midway. */
  beforeCommit?: (db: Transaction) => Promise<void>
}

/**
 * Opens the state database as its owner and brings it to the current schema, after `upgradeStorage` has brought the
 * files to theirs. Without a database, what the state folder holds is imported first — the `node:sqlite` file of
 * versions 1–2, otherwise the v0.1 files: read and checked whole, written into a new database in one transaction, which
 * takes its place only once complete; then each imported file is renamed to `<name>.imported`. A file that is still
 * there next to an existing database is not read, and the log says so once per start.
 */
export async function prepareDatabase(options: PrepareOptions): Promise<StateDatabase> {
  const { stateDir, log } = options
  const dir = databaseDirOf(stateDir)
  const legacy = join(stateDir, SQLITE_FILE)
  if (databaseExists(dir)) {
    const opened = await openStateDatabase(dir)
    const stray = [...Object.values(STATE_FILES), SQLITE_FILE].filter((name) => existsSync(join(stateDir, name)))
    if (stray.length > 0) log(`storage: ${stray.join(', ')} in ${stateDir} are not read: the state is in ${dir} (BTN-198)`)
    return opened
  }
  if (existsSync(legacy)) {
    const rows = await sqliteRows(legacy, true)
    // The file's tables are those of step 3: its rows go into a database of that step, which the open migrates on.
    await importInto(dir, (tx) => insertRows(tx, rows), options, STEPS.slice(0, 1))
    keepImported(stateDir, [SQLITE_FILE], log)
    log(`storage: moved ${legacy} into ${dir}: ${counted(rows)}; the file is kept as ${SQLITE_FILE}${IMPORTED_SUFFIX}`)
    return openStateDatabase(dir)
  }
  const files = readStateFiles(stateDir, log)
  const legacyAccounts = existsSync(join(stateDir, 'account.json'))
  await importInto(dir, async (tx) => {
    if (files !== undefined) await writeState(tx, files)
    if (files !== undefined || legacyAccounts) {
      await tx.query("insert into service_state (name, value) values ('accounts.adoptLegacy', 'true') on conflict do nothing")
    }
  }, options)
  if (files === undefined) return openStateDatabase(dir)
  keepImported(stateDir, Object.values(STATE_FILES), log)
  const { chain, questions, launches, handoffs } = files
  log(
    `storage: moved the state into ${dir}: the chain${chain === undefined ? ' (none saved)' : ''}, ${questions.length} questions, ` +
      `${launches.length} launches, ${handoffs.length} handoff snapshots; the files are kept as *${IMPORTED_SUFFIX}`,
  )
  return openStateDatabase(dir)
}

/** A new database in `dir`, filled in one transaction and moved into place only once complete. */
async function importInto(dir: string, fill: (tx: Transaction) => Promise<void>, options: PrepareOptions, steps: readonly string[] = STEPS): Promise<void> {
  const temp = `${dir}.import`
  rmSync(temp, { recursive: true, force: true })
  try {
    const db = await openDatabase(dataDirOf(temp), steps)
    try {
      await db.transaction(async (tx) => {
        await fill(tx)
        await options.beforeCommit?.(tx)
      })
    } finally {
      await db.close()
    }
    renameSync(temp, dir)
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    throw fail('storage.importFailed', { file: dir }, {}, { cause: error })
  }
}

function keepImported(stateDir: string, names: string[], log: (line: string) => void): void {
  for (const name of names) {
    const path = join(stateDir, name)
    if (!existsSync(path)) continue
    try {
      renameSync(path, `${path}${IMPORTED_SUFFIX}`)
    } catch (error) {
      log(`storage: ${path} was imported but not renamed (${(error as Error).message}); it is not read any more`)
    }
  }
}

function counted(rows: Rows): string {
  const tables = Object.entries(rows).filter(([, list]) => list.length > 0)
  return tables.length === 0 ? 'no rows' : tables.map(([table, list]) => `${list.length} ${table}`).join(', ')
}

/** The state of v0.1 files, projects by id as the files name them. */
export interface StateFiles {
  chain: Record<string, unknown> | undefined
  questions: PostedQuestion[]
  launches: LaunchEntry[]
  handoffs: HandoffSnapshot[]
}

/** The v0.1 files of the folder, checked whole; `undefined` — there are none. */
export function readStateFiles(stateDir: string, log: (line: string) => void = () => {}): StateFiles | undefined {
  const present = Object.values(STATE_FILES).filter((name) => existsSync(join(stateDir, name)))
  if (present.length === 0) return undefined
  const chainFile = join(stateDir, STATE_FILES.chain)
  const chain = readJson(chainFile)
  if (chain !== undefined) {
    refuseNewer(chainFile, versionOf(chain))
    try {
      chainStateOf(chain, chainFile)
    } catch (error) {
      throw fail('storage.damaged', { file: chainFile }, {}, { cause: error })
    }
  }
  return {
    chain: chain as Record<string, unknown> | undefined,
    questions: readQuestionsFile(join(stateDir, STATE_FILES.questions)),
    launches: readLaunchFile(join(stateDir, STATE_FILES.launches)),
    handoffs: readHandoffDir(join(stateDir, STATE_FILES.handoffs), log),
  }
}

async function writeState(db: Db, files: StateFiles): Promise<void> {
  if (files.chain !== undefined) {
    const state = chainStateOf(files.chain, STATE_FILES.chain)
    await writeChainRecord(db, state)
    // The chain's switches are Even Keel's setting rows since BTN-199.
    await mirrorDefinitions(db)
    const row = (key: 'unattended' | 'trimTools') => ({ key, project: null, qualifier: '', value: state[key] })
    await putSettings(db, [row('unattended'), row('trimTools')], 'import')
  }
  await saveQuestions(db, files.questions)
  for (const entry of files.launches) await appendLaunch(db, entry)
  for (const snapshot of files.handoffs) await saveSnapshot(db, snapshot)
}

function readQuestionsFile(file: string): PostedQuestion[] {
  const parsed = readJson(file)
  if (parsed === undefined) return []
  if (!Array.isArray(parsed)) refuseNewer(file, versionOf(parsed))
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.questions) ? parsed.questions : []
  const valid = list.every((question) => isRecord(question) && ['task', 'sessionId', 'ask', 'comment'].every((field) => typeof question[field] === 'string'))
  if (!valid) throw fail('storage.damaged', { file })
  return list as PostedQuestion[]
}

function readLaunchFile(file: string): LaunchEntry[] {
  const text = readText(file)
  if (text === undefined) return []
  let lines: unknown[]
  try {
    lines = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown)
  } catch {
    throw fail('storage.damaged', { file })
  }
  if (isVersionLine(lines[0])) refuseNewer(file, versionOf(lines.shift()))
  const valid = lines.every((entry) => isRecord(entry) && ['at', 'project', 'task', 'sessionId'].every((field) => typeof entry[field] === 'string'))
  if (!valid) throw fail('storage.damaged', { file })
  return lines as LaunchEntry[]
}

/** A snapshot file that does not parse is left out: it was cut short when written, and Tally could not read it either. */
function readHandoffDir(dir: string, log: (line: string) => void): HandoffSnapshot[] {
  if (!existsSync(dir)) return []
  const snapshots: HandoffSnapshot[] = []
  for (const name of readdirSync(dir).filter((each) => each.endsWith('.json')).sort()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch {
      log(`storage: ${join(dir, name)} is not a snapshot, left out of the import`)
      continue
    }
    const sessionId = isRecord(parsed) && typeof parsed.sessionId === 'string' ? parsed.sessionId : name.slice(0, -'.json'.length)
    snapshots.push({ ...(isRecord(parsed) ? parsed : {}), sessionId } as HandoffSnapshot)
  }
  return snapshots
}

/**
 * Writes the database's state into `dir` as v0.1 files — what a v0.1 Even Keel reads, and what the import reads back.
 * The closed tasks have no such file; a copy of the database (`backupDatabase`) keeps everything.
 */
export async function exportState(db: Queryable, dir: string): Promise<void> {
  writeAtomic(join(dir, STATE_FILES.chain), `${JSON.stringify({ version: SCHEMA_VERSION, ...(await loadChainState(db)) }, null, 2)}\n`)
  writeAtomic(join(dir, STATE_FILES.questions), `${JSON.stringify({ version: SCHEMA_VERSION, questions: await loadQuestions(db) }, null, 2)}\n`)
  writeAtomic(join(dir, STATE_FILES.launches), [{ version: SCHEMA_VERSION }, ...(await readLaunches(db))].map((line) => `${JSON.stringify(line)}\n`).join(''))
  const handoffs = join(dir, STATE_FILES.handoffs)
  mkdirSync(handoffs, { recursive: true })
  for (const snapshot of await readSnapshots(db)) writeFileSync(join(handoffs, `${snapshot.sessionId}.json`), `${JSON.stringify(snapshot, null, 2)}\n`)
}

function readJson(file: string): unknown {
  const text = readText(file)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    throw fail('storage.damaged', { file })
  }
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
