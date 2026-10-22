import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { CONFIG_FILE } from './config.js'
import { EnvFile } from './env-file.js'
import type { InstallSource } from './updates/model.js'

/** The nearest folder from `dir` up with a `package.json`: the same root from `src/` under tsx and from `dist/src/`. */
export function packageRoot(dir: string, exists: (path: string) => boolean = existsSync): string {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (exists(join(at, 'package.json'))) return at
    if (dirname(at) === at) throw new Error(`no package.json above ${dir}`)
  }
}

export function sourceOf(root: string, exists: (path: string) => boolean = existsSync): InstallSource {
  return exists(join(root, 'src', 'main.ts')) ? 'git' : 'npm'
}

/** The data folder of a package installed by npm: npm replaces the package's own folder at every update. */
export function dataDirOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, userHome: string): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(userHome, 'AppData', 'Local'), 'even-keel')
  if (platform === 'darwin') return join(userHome, 'Library', 'Application Support', 'even-keel')
  return join(env.XDG_DATA_HOME || join(userHome, '.local', 'share'), 'even-keel')
}

/**
 * Where `.env`, `state/` and `logs/` are: `EVEN_KEEL_DATA`, else a checkout's own folder, else `dataDirOf`. Not
 * `EVEN_KEEL_HOME`: the `tally` plugin finds the code by it (BTN-263).
 */
export function homeOf(root: string, source: InstallSource, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, userHome: string): string {
  if (env.EVEN_KEEL_DATA) return resolve(env.EVEN_KEEL_DATA)
  return source === 'git' ? root : dataDirOf(env, platform, userHome)
}

/** The folder of Even Keel's code: the checkout or the installed package. */
export const root = packageRoot(import.meta.dirname)
export const source = sourceOf(root)
/** The folder of its data; a checkout's own unless `EVEN_KEEL_DATA` says otherwise. Read before `.env`, which is in it. */
export const home = homeOf(root, source, process.env, process.platform, homedir())

let envFile: EnvFile | undefined

/** Loads `.env` of the data folder into `process.env` once, a missing file is no error; later calls return the same file to watch. */
export function loadEnv(): EnvFile {
  envFile ??= new EnvFile({ file: join(home, '.env'), env: process.env, intervalMs: ENV_POLL_MS, warn: (message) => console.warn(message) })
  return envFile
}

const ENV_POLL_MS = 2_000

/** The config file of an install from before BTN-199: imported into the database at the first start, never read after. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.EVEN_KEEL_CONFIG ?? join(home, CONFIG_FILE)
}

export function stateDirOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.EVEN_KEEL_STATE_DIR ?? join(home, 'state')
}
