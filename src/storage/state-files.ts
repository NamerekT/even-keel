import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { LaunchEntry } from '../chain/model.js'
import { readSnapshots, saveSnapshot, type HandoffSnapshot } from '../chain/snapshots.js'
import { appendLaunch, chainStateOf, loadChainState, loadQuestions, readLaunches, saveQuestions, writeChainRecord } from '../chain/store.js'
import { fail } from '../notice/notice.js'
import type { PostedQuestion } from '../tracker/questions.js'
import { writeAtomic } from './atomic.js'
import { DATABASE_FILE, inTransaction, openDatabase } from './database.js'
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
  beforeCommit?: (db: DatabaseSync) => void
}

/**
 * Brings the state database to the current schema, after `upgradeStorage` has brought the files to theirs. Without a
 * database the v0.1 files of `state/` are imported first: read and checked whole, written into a new database in one
 * transaction, which takes its place only once complete; then each file is renamed to `<name>.imported`. A file that
 * is still there next to an existing database is not read, and the log says so once per start.
 */
export function prepareDatabase(options: PrepareOptions): void {
  const { stateDir, log } = options
  const file = join(stateDir, DATABASE_FILE)
  if (existsSync(file)) {
    openDatabase(file).close()
    const stray = Object.values(STATE_FILES).filter((name) => existsSync(join(stateDir, name)))
    if (stray.length > 0) log(`storage: ${stray.join(', ')} in ${stateDir} are not read: the state is in ${file} (BTN-147)`)
    return
  }
  const files = readStateFiles(stateDir, log)
  if (files === undefined) {
    openDatabase(file).close()
    return
  }
  const temp = `${file}.import`
  removeDatabase(temp)
  try {
    const db = openDatabase(temp)
    try {
      inTransaction(db, () => {
        writeState(db, files)
        options.beforeCommit?.(db)
      })
    } finally {
      db.close()
    }
    renameSync(temp, file)
  } catch (error) {
    removeDatabase(temp)
    throw fail('storage.importFailed', { file }, {}, { cause: error })
  }
  for (const name of Object.values(STATE_FILES)) {
    const path = join(stateDir, name)
    if (!existsSync(path)) continue
    try {
      renameSync(path, `${path}${IMPORTED_SUFFIX}`)
    } catch (error) {
      log(`storage: ${path} was imported but not renamed (${(error as Error).message}); it is not read any more`)
    }
  }
  const { chain, questions, launches, handoffs } = files
  log(
    `storage: moved the state into ${file}: the chain${chain === undefined ? ' (none saved)' : ''}, ${questions.length} questions, ` +
      `${launches.length} launches, ${handoffs.length} handoff snapshots; the files are kept as *${IMPORTED_SUFFIX}`,
  )
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
      chainStateOf(chain, {}, chainFile)
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

function writeState(db: DatabaseSync, files: StateFiles): void {
  if (files.chain !== undefined) writeChainRecord(db, chainStateOf(files.chain, {}, STATE_FILES.chain))
  saveQuestions(db, files.questions)
  for (const entry of files.launches) appendLaunch(db, entry)
  for (const snapshot of files.handoffs) saveSnapshot(db, snapshot)
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
export function exportState(db: DatabaseSync, dir: string): void {
  writeAtomic(join(dir, STATE_FILES.chain), `${JSON.stringify({ version: SCHEMA_VERSION, ...loadChainState(db) }, null, 2)}\n`)
  writeAtomic(join(dir, STATE_FILES.questions), `${JSON.stringify({ version: SCHEMA_VERSION, questions: loadQuestions(db) }, null, 2)}\n`)
  writeAtomic(join(dir, STATE_FILES.launches), [{ version: SCHEMA_VERSION }, ...readLaunches(db)].map((line) => `${JSON.stringify(line)}\n`).join(''))
  const handoffs = join(dir, STATE_FILES.handoffs)
  mkdirSync(handoffs, { recursive: true })
  for (const snapshot of readSnapshots(db)) writeFileSync(join(handoffs, `${snapshot.sessionId}.json`), `${JSON.stringify(snapshot, null, 2)}\n`)
}

/** A consistent copy of the database into a new file, while the service may be writing it. */
export function backupDatabase(db: DatabaseSync, file: string): void {
  if (existsSync(file)) throw new Error(`storage: ${file} exists; give a new file`)
  db.prepare('VACUUM INTO ?').run(file)
}

function removeDatabase(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${file}${suffix}`, { force: true })
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
