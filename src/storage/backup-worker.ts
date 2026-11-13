import { parentPort, workerData } from 'node:worker_threads'
import { BackupError, makeCopy, type CopyJob } from './backup.js'
import type { CopyAnswer } from './backup-schedule.js'

// One automatic copy on its own thread (BTN-1083): writing a database, opening it back and hashing the attachments
// would stall the service's event loop.

const answer: CopyAnswer = await makeCopy(workerData as CopyJob).then(
  (check) => ({ check }),
  (error: unknown) => ({
    stage: error instanceof BackupError ? error.stage : 'copy',
    error: error instanceof Error ? error.message : String(error),
  }),
)
parentPort!.postMessage(answer)
