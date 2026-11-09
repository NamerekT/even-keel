import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathsOf, samePath } from '../paths.js'
import { SETTINGS_GUARD_MARK as MARK, stripSettingsGuard } from './settingsGuardStrip.js'

export { stripSettingsGuard }

type Json = Record<string, unknown>

export interface SettingsGuardConfig {
  accountsDir: string
  globalDir: string
  url: string
}

function object(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {}
}

export function withSettingsGuard(settings: Json, config: SettingsGuardConfig): Json {
  const clean = stripSettingsGuard(settings)
  const hooks = object(clean.hooks)
  const script = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../../dist/src/account/settingsHook.js' : './settingsHook.js', import.meta.url))
  const data = Buffer.from(JSON.stringify(config)).toString('base64url')
  return { ...clean, hooks: { ...hooks, PreToolUse: [
    ...(Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : []),
    { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: process.execPath,
      args: [script, MARK, data], timeout: 5, onFailure: 'continue' }] },
  ] } }
}

export function removeSettingsGuard(dir: string): void {
  const file = join(dir, 'settings.json')
  try {
    const settings = JSON.parse(readFileSync(file, 'utf8')) as Json
    const clean = stripSettingsGuard(settings)
    if (clean !== settings) writeFileSync(file, JSON.stringify(clean, null, 2))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

/** Uninstall keeps account folders and user hooks; only managed Claude folders are visited. */
export function removeAccountSettingsGuards(accountsDir: string, globalDir: string): void {
  let entries
  try { entries = readdirSync(accountsDir, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const dir = join(accountsDir, entry.name)
    if (!entry.isDirectory() || samePath(dir, globalDir)) continue
    try { removeSettingsGuard(dir) } catch (error) {
      console.warn(`account settings guard: could not remove hook from ${dir}: ${String(error)}`)
    }
  }
}

/** No HTTP call for ordinary edits. The service confirms that a candidate belongs to a listed Claude account. */
export async function guardSettingsEdit(input: unknown, config: SettingsGuardConfig,
  ask: () => Promise<unknown> = async () => {
    const response = await fetch(`${config.url}/api/state`, { signal: AbortSignal.timeout(1500), redirect: 'error' })
    return response.ok ? response.json() : null
  }, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  try {
    const event = object(input)
    if (!['Edit', 'Write', 'MultiEdit'].includes(String(event.tool_name))) return null
    const tool = object(event.tool_input)
    const paths = pathsOf(platform)
    const targets = [tool.file_path, ...(Array.isArray(tool.edits) ? tool.edits.map((edit: unknown) => object(edit).file_path) : [])]
      .filter((path): path is string => typeof path === 'string' && path !== '')
      .map((path) => paths.resolve(typeof event.cwd === 'string' ? event.cwd : process.cwd(), path))
      .filter((path) => platform === 'linux' ? paths.basename(path) === 'settings.json' : paths.basename(path).toLowerCase() === 'settings.json')
      .filter((path) => samePath(paths.dirname(paths.dirname(path)), config.accountsDir, platform)
        && !samePath(paths.dirname(path), config.globalDir, platform)
        && samePath(path, paths.join(paths.dirname(path), 'settings.json'), platform))
    if (targets.length === 0) return null
    const accounts = object(object(await ask()).account).accounts
    if (!Array.isArray(accounts)) return null
    const managed = accounts.some((value: unknown) => {
      const account = object(value)
      return account.agent === 'claude' && account.global === false && typeof account.key === 'string'
        && paths.basename(account.key) === account.key
        && targets.some((path) => samePath(path, paths.join(config.accountsDir, account.key as string, 'settings.json'), platform))
    })
    return managed ? 'Even Keel manages this account folder’s settings.json. Edit shared settings in ~/.claude/settings.json; Even Keel transfers them to all Claude accounts before launch. For account-only settings, use Accounts in Even Keel: resolve a settings change with “Keep for this account only”.' : null
  } catch {
    return null
  }
}
