import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collect } from './collect.js'
import { dbSettings } from './config.js'
import { hulyOfProfiles } from './huly-profiles.js'
import { openLocalTally, tallyDir } from './local.js'

// A collector run by hand, for debugging: the Even Keel service runs it every 5 minutes itself.

const EXIT_GRACE_MS = 10_000

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
try {
  process.loadEnvFile(join(root, '.env'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`)
// Without the service there are no profiles to hand over: a run by hand asks Huly with the `HULY_*` of the environment.
const hulyOf = hulyOfProfiles({ projects: {}, fallback: process.env as Record<string, string> })

async function run(): Promise<number> {
  const server = dbSettings(process.env)
  if (server !== null) return collect(server, root, log, hulyOf)
  const local = await openLocalTally(tallyDir(process.env.EVEN_KEEL_STATE_DIR ?? join(root, 'state')), log)
  try {
    return await collect(local.settings, root, log, hulyOf)
  } finally {
    await local.close()
  }
}

// process.exit right after a failed fetch trips a libuv assertion on Windows (UV_HANDLE_CLOSING):
// let the loop drain and force the exit only if something still holds it.
const finish = (code: number) => {
  process.exitCode = code
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref()
}

run().then(finish, (error: unknown) => {
  log(`tally: ${(error as Error).stack ?? String(error)}`)
  finish(1)
})
