import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { fail } from '../notice/notice.js'
import { samePath } from '../paths.js'
import { CODEX_ACCOUNT, folderName, GLOBAL_ACCOUNT, parseCredentialTimes, type CredentialTimes } from './model.js'
import { API_KEY_VARIABLE, shareConfig } from './share.js'

const PENDING_PREFIX = '.pending-'
const LOCK_SUFFIX = '.lock'
const APPROVED_SUFFIX = 20
const API_KEY_PATTERN = new RegExp(`^\\S{${APPROVED_SUFFIX + 1},}$`)
const RESERVED = [GLOBAL_ACCOUNT, CODEX_ACCOUNT]
const CODEX_AUTH = 'auth.json'
const CODEX_KEY_FIELD = 'OPENAI_API_KEY'

export interface AccountHome {
  key: string
  dir: string
  /** The agent's own default folder (`~/.claude`, `~/.codex`), not one Even Keel made: it is never removed from here. */
  global: boolean
  /** The agent the folder is an account of; its sessions run on that agent (`src/agent/adapters.ts`). */
  agent: string
}

/**
 * The account folders: Claude Code's global `~/.claude` and one `CLAUDE_CONFIG_DIR` per account under the root; Codex's
 * own folder (`CODEX_HOME` or `~/.codex`) once it exists — Codex does not create it — and one `CODEX_HOME` per account
 * under the Codex root (BTN-176). A folder's name is its key across both roots: a Codex folder named like a Claude one
 * is left out, and a new one is named apart from both.
 */
export class AccountHomes {
  readonly global: AccountHome
  private readonly codex: AccountHome
  private roots: Record<string, string> = {}

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    root: string,
    codexRoot = codexAccountsRoot(env),
  ) {
    this.global = { key: GLOBAL_ACCOUNT, dir: env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), global: true, agent: CLAUDE }
    this.codex = { key: CODEX_ACCOUNT, dir: env.CODEX_HOME ?? join(homedir(), '.codex'), global: true, agent: CODEX }
    this.setRoots(root, codexRoot)
  }

  /** The folders under the new roots count from the next `list`: `EVEN_KEEL_ACCOUNTS_DIR` changes on the fly. */
  setRoots(root: string, codexRoot: string): void {
    this.roots = { [CLAUDE]: root, [CODEX]: codexRoot }
  }

  list(): AccountHome[] {
    const claude = this.folders(CLAUDE)
    const codex = this.folders(CODEX).filter((name) => !claude.includes(name))
    return [
      this.global,
      ...claude.map((name) => this.home(CLAUDE, name)),
      ...(existsSync(this.codex.dir) ? [this.codex] : []),
      ...codex.map((name) => this.home(CODEX, name)),
    ]
  }

  find(key: string): AccountHome | undefined {
    return this.list().find((home) => home.key === key)
  }

  ownerOf(configDir: string | null): string | undefined {
    if (configDir === null) return GLOBAL_ACCOUNT
    return this.list().find((home) => samePath(home.dir, configDir))?.key
  }

  times(home: AccountHome): CredentialTimes {
    let text: string | undefined
    try {
      text = readFileSync(join(home.dir, '.credentials.json'), 'utf8')
    } catch {
      text = undefined
    }
    return parseCredentialTimes(text)
  }

  /** A folder to sign a new account of the agent in; Codex does not create its folder, so it is made here for both. */
  pending(now: Date, agent: string): AccountHome {
    const home = this.home(agent, `${PENDING_PREFIX}${now.getTime().toString(36)}`)
    mkdirSync(home.dir, { recursive: true })
    return home
  }

  place(pending: AccountHome, email: string | null): AccountHome {
    const name = folderName(email, this.taken())
    const home = this.home(pending.agent, name)
    renameSync(pending.dir, home.dir)
    return home
  }

  /**
   * An API account. Claude's: a folder whose `settings.json` carries the key (`mergeSettings` keeps it there) and whose
   * `.claude.json` has it approved, or the CLI asks whether to use it (BTN-136). Codex's: an `auth.json` the way
   * `codex login --with-api-key` writes it (BTN-177).
   */
  addApiKey(name: string, key: string, agent: string = CLAUDE): AccountHome {
    const value = assertApiKey(key, agent)
    const home = this.home(agent, folderName(name.trim() === '' ? 'api' : name, this.taken()))
    mkdirSync(home.dir, { recursive: true })
    if (agent === CODEX) {
      writeFileSync(join(home.dir, CODEX_AUTH), JSON.stringify({ auth_mode: 'apikey', [CODEX_KEY_FIELD]: value }, null, 2))
      return home
    }
    writeFileSync(join(home.dir, 'settings.json'), JSON.stringify({ env: { [API_KEY_VARIABLE]: value } }, null, 2))
    const approved = { customApiKeyResponses: { approved: [value.slice(-APPROVED_SUFFIX)], rejected: [] } }
    writeFileSync(join(home.dir, '.claude.json'), JSON.stringify(approved, null, 2))
    return home
  }

  /** The key in Claude's `settings.json` or Codex's `auth.json`; a folder with `apiKeyHelper` has none to read. */
  apiKeyOf(home: AccountHome): string | null {
    try {
      const key =
        home.agent === CODEX
          ? JSON.parse(readFileSync(join(home.dir, CODEX_AUTH), 'utf8'))?.[CODEX_KEY_FIELD]
          : JSON.parse(readFileSync(join(home.dir, 'settings.json'), 'utf8'))?.env?.[API_KEY_VARIABLE]
      return typeof key === 'string' && key !== '' ? key : null
    } catch {
      return null
    }
  }

  /** Claude's shared configuration into an account folder; Codex reads its own `config.toml`. */
  share(home: AccountHome): boolean {
    if (home.global || home.agent !== CLAUDE) return false
    return shareConfig({ dir: this.global.dir, config: this.configFile(this.global) }, home.dir)
  }

  /** The `.claude.json` the CLI reads with this folder. */
  configFile(home: AccountHome): string {
    if (!home.global) return join(home.dir, '.claude.json')
    return this.env.CLAUDE_CONFIG_DIR === undefined ? join(homedir(), '.claude.json') : join(this.global.dir, '.claude.json')
  }

  remove(home: AccountHome): void {
    if (home.global) throw fail('account.globalKept', {})
    rmSync(home.dir, { recursive: true, force: true, maxRetries: 3 })
  }

  private home(agent: string, name: string): AccountHome {
    const root = this.roots[agent]
    if (root === undefined) throw fail('request.required', { field: 'agent' })
    return { key: name, dir: join(root, name), global: false, agent }
  }

  private taken(): string[] {
    return Object.keys(this.roots).flatMap((agent) => this.folders(agent))
  }

  private folders(agent: string): string[] {
    try {
      return readdirSync(this.roots[agent]!, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith(LOCK_SUFFIX) && !RESERVED.includes(entry.name),
        )
        .map((entry) => entry.name)
        .sort()
    } catch {
      return []
    }
  }
}

/** The trimmed key, or a refusal of one that is not a single word long enough to approve. */
export function assertApiKey(key: string, agent: string = CLAUDE): string {
  const value = key.trim()
  if (!API_KEY_PATTERN.test(value)) throw fail(agent === CODEX ? 'account.codexKeyInvalid' : 'account.apiKeyInvalid', {})
  return value
}

export function accountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_ACCOUNTS_DIR ?? join(homedir(), '.claude-accounts')
}

export function codexAccountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_CODEX_ACCOUNTS_DIR ?? join(homedir(), '.codex-accounts')
}
