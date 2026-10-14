import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import type { DbSettings } from './config.js'
import { migrate, pgliteDb } from './migrations.js'

// The local Tally database: PGlite in <state>/tally/pgdata, served to pg clients on a loopback port.
// PGlite has one session per process, so one process owns the folder; owner.json names it and its port.

const MAX_CONNECTIONS = 16
const CONNECT_TIMEOUT_MS = 1_000

export interface Owner {
  pid: number
  port: number
}

export interface LocalTally {
  settings: DbSettings
  close(): Promise<void>
}

export const tallyDir = (stateDir: string) => join(stateDir, 'tally')
const ownerFile = (dir: string) => join(dir, 'owner.json')

export function localSettings(port: number): DbSettings {
  return { host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: '' }
}

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

export async function openLocalTally(dir: string): Promise<LocalTally> {
  const owner = await readOwner(dir)
  if (owner !== null && owner.pid !== process.pid) {
    throw new Error(`tally: process ${owner.pid} (the Even Keel service) holds the local database in ${dir}; stop it first`)
  }
  mkdirSync(dir, { recursive: true })
  const db = await PGlite.create({ dataDir: join(dir, 'pgdata') })
  try {
    // Days and weeks without an explicit zone are UTC, as on the server.
    await db.exec(`set timezone = 'UTC'`)
    // A newer database still opens: the page says so, and the collector stops on it with a line in the log.
    await migrate(pgliteDb(db))
    const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: MAX_CONNECTIONS })
    await server.start()
    const port = Number(server.getServerConn().split(':').at(-1))
    writeFileSync(ownerFile(dir), JSON.stringify({ pid: process.pid, port } satisfies Owner))
    return {
      settings: localSettings(port),
      close: async () => {
        rmSync(ownerFile(dir), { force: true })
        await server.stop()
        await db.close()
      },
    }
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}
