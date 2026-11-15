import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it } from 'vitest'
import type { CollectRun } from '../../src/stats/tally.js'
import { HALTED, TALLY_SCHEMA_VERSION } from '../../src/stats/tally-schema.js'
import { newerBuildLine } from './migrations.js'

let home: string | null = null
afterEach(() => {
  if (home !== null) rmSync(home, { recursive: true, force: true })
  home = null
})

// The real worker file, as the service starts it on every run, but with a service that knows one step fewer (BTN-1208).
it('halts without opening the database when it knows more schema steps than the service that started it', async () => {
  home = mkdtempSync(join(tmpdir(), 'tally-worker-'))
  const run: CollectRun = {
    root: home,
    home,
    // Nothing listens there: a run that went on to the database would end with 1, not HALTED.
    settings: { host: '127.0.0.1', port: 1, database: 'tally', user: 'writer', password: 'fake' },
    huly: { projects: {}, fallback: null },
    trackers: [],
    schema: TALLY_SCHEMA_VERSION - 1,
  }
  const worker = new Worker(new URL('./collect-worker.ts', import.meta.url), { workerData: run, execArgv: ['--import', 'tsx'], stdout: true })
  let out = ''
  worker.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  const code = await new Promise<unknown>((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
  })
  await worker.terminate()
  expect(code).toBe(HALTED)
  expect(out.trim().split('\n')).toHaveLength(1)
  expect(out).toContain(newerBuildLine(TALLY_SCHEMA_VERSION - 1)!)
}, 30_000)

it('names the restart only when the build is newer than the service', () => {
  expect(newerBuildLine(15, 16)).toBe('tally: this build knows Tally schema v16, but the running service only v15: nothing is migrated or collected until Even Keel restarts')
  expect(newerBuildLine(16, 16)).toBeNull()
  expect(newerBuildLine(17, 16)).toBeNull()
})
