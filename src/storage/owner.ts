import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { checkVersion, DATABASE_DIR, openDatabase, type Queryable } from './database.js'

// A PGlite folder has one session in one process: the process that opened it owns it, serves it to pg clients on a
// loopback port and names itself and the port in owner.json. Everyone else reads through that port (BTN-198).

const MAX_CONNECTIONS = 8
const CONNECT_TIMEOUT_MS = 1_000

export interface Owner {
  pid: number
  port: number
}

const ownerFile = (dir: string) => join(dir, 'owner.json')
export const dataDirOf = (dir: string) => join(dir, 'pgdata')
export const databaseDirOf = (stateDir: string) => join(stateDir, DATABASE_DIR)

/** A PGlite folder is a database once `initdb` has finished in it. */
export const databaseExists = (dir: string) => existsSync(join(dataDirOf(dir), 'PG_VERSION'))

// A live owner both runs and listens: after a crash its pid may belong to another process by now.
export async function readOwner(dir: string): Promise<Owner | null> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(ownerFile(dir), 'utf8'))
  } catch {
    return null
  }
  const { pid, port } = (raw ?? {}) as Partial<Owner>
  if (!Number.isInteger(pid) || !Number.isInteger(port)) return null
  return alive(pid!) && (await listening(port!)) ? { pid: pid!, port: port! } : null
}

export function writeOwner(dir: string, owner: Owner): void {
  writeFileSync(ownerFile(dir), JSON.stringify(owner))
}

export function removeOwner(dir: string): void {
  rmSync(ownerFile(dir), { force: true })
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
  await refuseOwned(dir)
  return served(dir, await openDatabase(dataDirOf(dir), steps))
}

async function refuseOwned(dir: string): Promise<void> {
  const owner = await readOwner(dir)
  if (owner !== null) throw new Error(`storage: process ${owner.pid} holds the database in ${dir}; stop it first`)
}

async function served(dir: string, db: PGlite): Promise<StateDatabase> {
  try {
    const server = new PGLiteSocketServer({ db: wholeTransactions(db), host: '127.0.0.1', port: 0, maxConnections: MAX_CONNECTIONS })
    await server.start()
    writeOwner(dir, { pid: process.pid, port: Number(server.getServerConn().split(':').at(-1)) })
    return {
      db,
      close: async () => {
        removeOwner(dir)
        await server.stop()
        await db.close()
      },
    }
  } catch (error) {
    await db.close().catch(() => {})
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
 * service), otherwise opened here and served the same way until closed. `undefined` — there is no database yet.
 */
export async function readStateDatabase(stateDir: string): Promise<StateReader | undefined> {
  const dir = databaseDirOf(stateDir)
  if (!databaseExists(dir)) return undefined
  const owner = await readOwner(dir)
  const reader = owner === null ? await openedHere(dir) : await client(owner.port)
  try {
    await checkVersion(reader.db, dir)
    return reader
  } catch (error) {
    await reader.close()
    throw error
  }
}

async function openedHere(dir: string): Promise<StateReader> {
  return served(dir, await PGlite.create({ dataDir: dataDirOf(dir) }))
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
