import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_FILE } from './config.js'

/** The checkout Even Keel runs from. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Loads `.env` of the checkout into `process.env`; a missing file is no error. */
export function loadEnv(): void {
  try {
    process.loadEnvFile(join(root, '.env'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.EVEN_KEEL_CONFIG ?? join(root, CONFIG_FILE)
}

export function stateDirOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.EVEN_KEEL_STATE_DIR ?? join(root, 'state')
}
