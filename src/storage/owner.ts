import { randomUUID } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { checkVersion, DATABASE_DIR, openDatabase, type Queryable } from './database.js'

// A PGlite folder has one session in one process: the process that opened it owns it, serves it to pg clients on a
// loopback port and names itself and the port in owner.json. Everyone else reads through that port (BTN-198).
// The file is claimed before PGlite opens the folder, with no port yet: two processes starting together cannot both
// see "no owner" and open it (BTN-301).

const MAX_CONNECTIONS = 8
const CONNECT_TIMEOUT_MS = 1_000
// A claim without a port whose pid still runs is an open in progress, unless it is this old: then its process died
// mid-open and the pid went to another one.
const OPENING_LIMIT_MS = 10 * 60_000
const READER_WAIT_MS = 30_000
const READER_POLL_MS = 100
const CLAIM_ATTEMPTS = 5

export interface Owner {
  pid: number
  port: number
}

/** What owner.json holds: the claimant, and its port once it serves the database. */
interface Claim {
  pid: number
  since: number
  port?: number
}

const ownerFile = (dir: string) => join(dir, 'owner.json')
export const dataDirOf = (dir: string) => join(dir, 'pgdata')
export const databaseDirOf = (stateDir: string) => join(stateDir, DATABASE_DIR)

/** A PGlite folder is a database once `initdb` has finished in it. */
export const databaseExists = (dir: string) => existsSync(join(dataDirOf(dir), 'PG_VERSION'))

export async function readOwner(dir: string): Promise<Owner | null> {
  const { claim } = await readClaim(dir)
  return claim?.port === undefined ? null : { pid: claim.pid, port: claim.port }
}

export function writeOwner(dir: string, owner: Owner): void {
  // A rename replaces the file whole: a reader never sees it half written.
  const draft = draftOf(dir)
  writeFileSync(draft, JSON.stringify({ ...owner, since: Date.now() }))
  renameSync(draft, ownerFile(dir))
}

export function removeOwner(dir: string): void {
  rmSync(ownerFile(dir), { force: true })
}

const draftOf = (dir: string) => join(dir, `owner.${randomUUID()}.tmp`)

/**
 * Claims the folder for this process, or names the live claimant that holds it: `null` — claimed here. The claim is a
 * hard link put in place, which fails while one is there, so of two processes only one gets it; one left by a process
 * that is gone is removed and claimed again.
 */
async function claim(dir: string): Promise<Claim | null> {
  mkdirSync(dir, { recursive: true })
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    if (placed(dir)) return null
    const found = await readClaim(dir)
    if (found.claim !== null) return found.claim
    if (found.raw !== undefined) removeUnchanged(dir, found.raw)
  }
  throw new Error(`storage: could not claim the database in ${dir}: its owner.json keeps changing`)
}

function placed(dir: string): boolean {
  const draft = draftOf(dir)
  writeFileSync(draft, JSON.stringify({ pid: process.pid, since: Date.now() } satisfies Claim))
  try {
    linkSync(draft, ownerFile(dir))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    rmSync(draft, { force: true })
  }
}

// Another process may have taken a stale claim's place since it was read: only the same text is removed.
function removeUnchanged(dir: string, raw: string): void {
  try {
    if (readFileSync(ownerFile(dir), 'utf8') === raw) removeOwner(dir)
  } catch {
    // Gone already.
  }
}

/** The live claim of the folder, if any, and the text of owner.json as read: `undefined` — there is none. */
async function readClaim(dir: string): Promise<{ claim: Claim | null; raw?: string }> {
  let raw: string
  try {
    raw = readFileSync(ownerFile(dir), 'utf8')
  } catch {
    return { claim: null }
  }
  return { claim: await liveClaim(raw), raw }
}

// A live owner both runs and listens: after a crash its pid may belong to another process by now.
async function liveClaim(raw: string): Promise<Claim | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const { pid, port, since } = (parsed ?? {}) as Partial<Claim>
  if (!Number.isInteger(pid) || !alive(pid!)) return null
  if (port === undefined) return Number.isFinite(since) && Date.now() - since! < OPENING_LIMIT_MS ? { pid: pid!, since: since! } : null
  return Number.isInteger(port) && (await listening(port)) ? { pid: pid!, since: since ?? 0, port } : null
}

function held(dir: string, claimant: Claim): Error {
  return new Error(`storage: process ${claimant.pid} holds the database in ${dir}; stop it first`)
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: CONNECT_TIMEOUT_MS })
    const finish = (open: boolean) => {
      socket.destroy()
      done(open)
    }
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** The state database held by this process. */
export interface StateDatabase {
  db: PGlite
  close(): Promise<void>
}

/**
 * Opens the database folder `dir` as its owner: brought to the current schema and served on a loopback port. Refused
 * while another live process owns it.
 */
export async function openStateDatabase(dir: string, steps?: readonly string[]): Promise<StateDatabase> {
  const claimant = await claim(dir)
  if (claimant !== null) throw held(dir, claimant)
  return served(dir, () => openDatabase(dataDirOf(dir), steps))
}

/** Opens the folder this process has claimed and serves it; the claim goes if that fails. */
async function served(dir: string, open: () => Promise<PGlite>): Promise<StateDatabase> {
  let db: PGlite | undefined
  try {
    db = await open()
    const server = new PGLiteSocketServer({ db: wholeTransactions(db), host: '127.0.0.1', port: 0, maxConnections: MAX_CONNECTIONS })
    await server.start()
    writeOwner(dir, { pid: process.pid, port: Number(server.getServerConn().split(':').at(-1)) })
    const opened = db
    return {
      db: opened,
      close: async () => {
        removeOwner(dir)
        await server.stop()
        await opened.close()
      },
    }
  } catch (error) {
    removeOwner(dir)
    await db?.close().catch(() => {})
    throw error
  }
}

// The socket server runs a client's query under PGlite's query lock only, which a transaction of this process lets go
// of between its statements: a reader would see the chain state half rewritten. Under the transaction lock it waits.
function wholeTransactions(db: PGlite): PGlite {
  return new Proxy(db, {
    get(target, key) {
      if (key === 'runExclusive') return <T>(body: () => Promise<T>) => target._runExclusiveTransaction(() => target.runExclusive(body))
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** A reader of the state database. */
export interface StateReader {
  db: Queryable
  close(): Promise<void>
}

/**
 * Reads the state database of the state folder without migrating it: through its owner's port while one runs (the
 * service), otherwise opened here and served the same way until closed. A process still opening it is waited for.
 * `undefined` — there is no database yet.
 */
export async function readStateDatabase(stateDir: string): Promise<StateReader | undefined> {
  const dir = databaseDirOf(stateDir)
  if (!databaseExists(dir)) return undefined
  const reader = await reached(dir)
  try {
    await checkVersion(reader.db, dir)
    return reader
  } catch (error) {
    await reader.close()
    throw error
  }
}

async function reached(dir: string): Promise<StateReader> {
  const deadline = Date.now() + READER_WAIT_MS
  for (;;) {
    const claimant = await claim(dir)
    if (claimant === null) return served(dir, () => PGlite.create({ dataDir: dataDirOf(dir) }))
    if (claimant.port !== undefined) return client(claimant.port)
    if (Date.now() > deadline) throw held(dir, claimant)
    await delay(READER_POLL_MS)
  }
}

async function client(port: number): Promise<StateReader> {
  const connection = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: '' })
  await connection.connect()
  const db: Queryable = { query: async <R>(sql: string, params?: unknown[]) => (await connection.query(sql, params)) as unknown as { rows: R[] } }
  return { db, close: () => connection.end() }
}

let kept: StateDatabase | undefined

/** `src/main.ts` opens the database before the service module loads; the service takes it from here. */
export function keepDatabase(database: StateDatabase): void {
  kept = database
}

export function keptDatabase(): StateDatabase {
  if (kept === undefined) throw new Error('storage: the state database was not opened before the service')
  return kept
}
