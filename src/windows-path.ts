import { execFile } from 'node:child_process'
import { pathFolders, pathKey } from './paths.js'

export const MACHINE_ENVIRONMENT = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
export const USER_ENVIRONMENT = 'HKCU\\Environment'

const QUERY_TIMEOUT_MS = 10_000

/** The answer of `reg query <key> /v Path`; `null` — no such value or no `reg.exe`. */
export type RegistryQuery = (key: string) => Promise<string | null>

const regQuery: RegistryQuery = (key) =>
  new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: QUERY_TIMEOUT_MS }, (error, stdout) => resolve(error === null ? stdout : null))
  })

/** The folders of a `reg query` answer's `Path`; a `REG_EXPAND_SZ` has its `%VAR%`s expanded from `env`, an unknown one kept. */
export function registryPathOf(query: string, env: NodeJS.ProcessEnv): string[] {
  const match = /^\s*Path\s+(REG_EXPAND_SZ|REG_SZ)(?:[ \t]+(.*))?$/im.exec(query)
  const value = match?.[2]?.trim() ?? ''
  const expanded = match?.[1] === 'REG_EXPAND_SZ' ? value.replace(/%([^%;]+)%/g, (whole, name: string) => valueOf(env, name) ?? whole) : value
  return expanded
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function valueOf(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1]
}

/** `current` with the folders of `added` it lacks at its end, each once; `null` — none new. */
export function addedPath(current: string, added: readonly string[], platform: NodeJS.Platform = process.platform): string | null {
  const entries = current.split(';').filter((entry) => entry.trim() !== '')
  const seen = new Set(entries.map((entry) => pathKey(entry.trim(), platform)))
  const fresh: string[] = []
  for (const folder of added) {
    const key = pathKey(folder, platform)
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push(folder)
  }
  return fresh.length === 0 ? null : [...entries, ...fresh].join(';')
}

/**
 * Adds to `env`'s PATH the folders the registry's machine and user `Path` have and it lacks (BTN-1723): node's own PATH
 * is frozen at its start, so a program installed since — git from its installer — would stay unseen until a restart.
 * `true` — something was added. Off Windows nothing is read.
 */
export async function refreshWindowsPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, query: RegistryQuery = regQuery): Promise<boolean> {
  if (platform !== 'win32') return false
  const [machine, user] = await Promise.all([MACHINE_ENVIRONMENT, USER_ENVIRONMENT].map(query))
  const folders = [machine, user].flatMap((answer) => (answer == null ? [] : registryPathOf(answer, env)))
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'Path'
  const merged = addedPath(pathFolders(env, platform).join(';'), folders, platform)
  if (merged === null) return false
  env[key] = merged
  return true
}
