import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountStatus } from '../account/model.js'

/**
 * An OpenCode account folder holds the four XDG folders OpenCode keeps its files in: `data` (`opencode/auth.json`, the
 * transcripts in `opencode/opencode.db`), `config` (`opencode/opencode.json`, `opencode/AGENTS.md`), `state` and
 * `cache` (BTN-214, `docs/accounts.md`).
 */
const XDG = { XDG_DATA_HOME: 'data', XDG_CONFIG_HOME: 'config', XDG_STATE_HOME: 'state', XDG_CACHE_HOME: 'cache' } as const

/**
 * What every OpenCode command gets on top of the base: the account's folders, no self-update (the version is the
 * user's to choose), and none of the skills of `~/.claude/skills` and `~/.agents/skills`, which XDG does not hide.
 */
export function openCodeEnv(base: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const folders = Object.fromEntries(Object.entries(XDG).map(([name, folder]) => [name, join(dir, folder)]))
  return { ...base, ...folders, OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1' }
}

export function databaseFile(dir: string): string {
  return join(dir, 'data', 'opencode', 'opencode.db')
}

function authFile(dir: string): string {
  return join(dir, 'data', 'opencode', 'auth.json')
}

/**
 * The account's `opencode/AGENTS.md`, made empty if missing: OpenCode takes the first of it and `~/.claude/CLAUDE.md`
 * as the global instructions, so the account's file keeps the user's Claude Code rules out of its sessions. The
 * project's own `AGENTS.md`, else `CLAUDE.md`, still reaches them.
 */
export function keepOwnInstructions(dir: string): void {
  const file = join(dir, 'config', 'opencode', 'AGENTS.md')
  if (existsSync(file)) return
  mkdirSync(join(dir, 'config', 'opencode'), { recursive: true })
  writeFileSync(file, '')
}

/** The provider an API key is of, by its prefix: OpenCode takes a key per provider, and the page asks only for the key. */
export function keyVendor(key: string): 'anthropic' | 'openai' {
  return key.startsWith('sk-ant-') ? 'anthropic' : 'openai'
}

/** The key into `auth.json` the way `opencode providers login` writes it: `{ "<provider>": { "type": "api", "key" } }`. */
export function writeKey(dir: string, key: string): void {
  mkdirSync(join(dir, 'data', 'opencode'), { recursive: true })
  writeFileSync(authFile(dir), JSON.stringify({ [keyVendor(key)]: { type: 'api', key } }, null, 2))
  keepOwnInstructions(dir)
}

/** The first API key of `auth.json`; `null` for a folder signed in otherwise or not at all. */
export function keyOf(dir: string): string | null {
  for (const credential of Object.values(credentials(readAuth(dir)))) {
    if (credential.type === 'api' && typeof credential.key === 'string' && credential.key !== '') return credential.key
  }
  return null
}

/**
 * The account as `auth.json` has it. A folder with no credential still runs OpenCode's free models, so it counts as
 * signed in, with the method `none`; the providers it holds go where Claude's plan goes, the e-mail is not known.
 */
export function parseAuth(text: string | undefined): AccountStatus {
  const held = Object.entries(credentials(text))
  const types = new Set(held.map(([, credential]) => credential.type))
  const authMethod = held.length === 0 ? 'none' : types.size === 1 && types.has('api') ? 'api_key' : 'oauth'
  return { loggedIn: true, authMethod, email: null, orgName: null, subscriptionType: held.length === 0 ? null : held.map(([name]) => name).join(', ') }
}

export function readAuth(dir: string): string | undefined {
  try {
    return readFileSync(authFile(dir), 'utf8')
  } catch {
    return undefined
  }
}

export function credentials(text: string | undefined): Record<string, Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(text ?? '')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => typeof entry[1] === 'object' && entry[1] !== null),
    )
  } catch {
    return {}
  }
}
