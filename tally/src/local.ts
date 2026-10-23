import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { claim, removeOwner, writeOwner } from '../../src/storage/claim.js'
import type { DbSettings } from './config.js'
import { migrate, migratedLine, pgliteDb } from './migrations.js'

// The local Tally database: PGlite in <state>/tally/pgdata, served to pg clients on a loopback port.
// PGlite has one session per process, so one process owns the folder; owner.json names it and its port, and is
// claimed before PGlite opens the folder, as the state database's is (src/storage/claim.ts).

const MAX_CONNECTIONS = 16

export interface LocalTally {
  settings: DbSettings
  close(): Promise<void>
}

export const tallyDir = (stateDir: string) => join(stateDir, 'tally')

export function localSettings(port: number): DbSettings {
  return { host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: '' }
}

export async function openLocalTally(dir: string, log: (message: string) => void): Promise<LocalTally> {
  const claimant = await claim(dir)
  if (claimant !== null) {
    throw new Error(`tally: process ${claimant.pid} (the Even Keel service) holds the local database in ${dir}; stop it first`)
  }
  let db: PGlite | undefined
  try {
    db = await PGlite.create({ dataDir: join(dir, 'pgdata') })
    // Days and weeks without an explicit zone are UTC, as on the server.
    await db.exec(`set timezone = 'UTC'`)
    // A newer database still opens: the page says so, and the collector stops on it with a line in the log.
    const migrated = migratedLine(await migrate(pgliteDb(db)))
    if (migrated !== null) log(migrated)
    const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: MAX_CONNECTIONS })
    await server.start()
    const port = Number(server.getServerConn().split(':').at(-1))
    writeOwner(dir, { pid: process.pid, port })
    const opened = db
    return {
      settings: localSettings(port),
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
