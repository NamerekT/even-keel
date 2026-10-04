import { parentPort, workerData } from 'node:worker_threads'
import type { CollectRun } from '../../src/stats/tally.js'
import { collect } from './collect.js'
import { dbSettings } from './config.js'

// One collector run on its own thread: parsing transcripts would stall the service's event loop.

const { settings, root } = workerData as CollectRun
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`)

const run = async () => {
  const server = settings ?? dbSettings(process.env)
  if (server === null) throw new Error('no database: neither a local one nor TALLY_DB_HOST')
  return collect(server, root, log)
}
const code = await run().catch((error: unknown) => {
  log(`tally: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  return 1
})
parentPort!.postMessage(code)
