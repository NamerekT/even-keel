import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { claim, type Claim, removeOwner, writeOwner } from './claim.js'
import { checkVersion, DATABASE_DIR, openDatabase, type Queryable } from './database.js'

export { type Owner, readOwner, removeOwner, writeOwner } from './claim.js'

// The state database's folder is owned as src/storage/claim.ts describes; everyone else reads through its port.

const MAX_CONNECTIONS = 8
const READER_WAIT_MS = 30_000
const READER_POLL_MS = 100

export const dataDirOf = (dir: string) => join(dir, 'pgdata')
export const databaseDirOf = (stateDir: string) => join(stateDir, DATABASE_DIR)

/** A PGlite folder is a database once `initdb` has finished in it. */
export const databaseExists = (dir: string) => existsSync(join(dataDirOf(dir), 'PG_VERSION'))

function held(dir: string, claimant: Claim): Error {
  return new Error(`storage: process ${claimant.pid} holds the database in ${dir}; stop it first`)
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
