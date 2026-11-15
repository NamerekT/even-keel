import { parentPort, workerData } from 'node:worker_threads'
import type { CollectRun } from '../../src/stats/tally.js'
import { HALTED } from '../../src/stats/tally-schema.js'
import { collect } from './collect.js'
import { dbSettings } from './config.js'
import { newerBuildLine } from './migrations.js'

// One collector run on its own thread: parsing transcripts would stall the service's event loop.

const { settings, root, home, huly, trackers, schema } = workerData as CollectRun
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`)

const run = async () => {
  const newer = newerBuildLine(schema)
  if (newer !== null) {
    log(newer)
    return HALTED
  }
  const server = settings ?? dbSettings(process.env)
  if (server === null) throw new Error('no database: neither a local one nor TALLY_DB_HOST')
  return collect(server, root, home, log, huly, trackers)
}
const code = await run().catch((error: unknown) => {
  log(`tally: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  return 1
})
parentPort!.postMessage(code)
