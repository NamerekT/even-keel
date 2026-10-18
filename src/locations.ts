import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_FILE } from './config.js'
import { EnvFile } from './env-file.js'

/** The checkout Even Keel runs from. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let envFile: EnvFile | undefined

/** Loads `.env` of the checkout into `process.env` once, a missing file is no error; later calls return the same file to watch. */
export function loadEnv(): EnvFile {
  envFile ??= new EnvFile({ file: join(root, '.env'), env: process.env, intervalMs: ENV_POLL_MS, warn: (message) => console.warn(message) })
  return envFile
}

const ENV_POLL_MS = 2_000

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.EVEN_KEEL_CONFIG ?? join(root, CONFIG_FILE)
}

export function stateDirOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.EVEN_KEEL_STATE_DIR ?? join(root, 'state')
}
