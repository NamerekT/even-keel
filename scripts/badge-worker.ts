// Copies the badge's drawing from src/badge/ into the Worker's folder: `npm run badge-worker`.
import { join } from 'node:path'
import { BADGE_WORKER_COPY, writeBadgeWorkerCopy } from './badge-worker-copy.js'

const files = writeBadgeWorkerCopy(join(import.meta.dirname, '..'))
console.log(`${files.length} files copied into ${BADGE_WORKER_COPY}`)
