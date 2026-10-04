import { parentPort, workerData } from 'node:worker_threads'
import type { HostMessage, HostRequest } from '../../src/stats/tally.js'
import { SCHEMA } from './db.js'
import { openLocalTally } from './local.js'

// The Even Keel service's thread that owns the local database: PGlite runs WASM queries on the thread
// that holds it, so a heavy one stalls this thread, not the dispatcher.

const port = parentPort!
const post = (message: HostMessage) => port.postMessage(message)

try {
  const local = await openLocalTally((workerData as { dir: string }).dir, SCHEMA)
  port.on('message', (request: HostRequest) => {
    if (request.type !== 'close') return
    local.close().then(
      () => post({ type: 'closed' }),
      () => post({ type: 'closed' }),
    )
  })
  post({ type: 'ready', settings: local.settings })
} catch (error) {
  post({ type: 'failed', error: error instanceof Error ? error.message : String(error) })
}
