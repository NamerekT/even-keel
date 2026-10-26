import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { tokenOf, writeToken } from '../copilot/home.js'
import { COPILOT } from '../copilot/name.js'
import { fail } from '../notice/notice.js'
import { keyOf, keyVendor, replaceKey, writeKey } from '../opencode/home.js'
import { OPENCODE } from '../opencode/name.js'
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
 * The account folders: Claude Code's global `~/.claude` once it exists and one `CLAUDE_CONFIG_DIR` per account under the
 * root; Codex's own folder (`CODEX_HOME` or `~/.codex`) once it exists — Codex does not create it — and one
 * `CODEX_HOME` per account under the Codex root (BTN-176). A folder's name is its key across both roots: a Codex folder
 * named like a Claude one is left out, and a new one is named apart from both.
 */
export class AccountHomes {
  readonly global: AccountHome
  private readonly codex: AccountHome
  private roots: Record<string, string> = {}

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    root: string,
    codexRoot = codexAccountsRoot(env),
    openCodeRoot = openCodeAccountsRoot(env),
    copilotRoot = copilotAccountsRoot(env),
  ) {
    this.global = { key: GLOBAL_ACCOUNT, dir: env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), global: true, agent: CLAUDE }
    this.codex = { key: CODEX_ACCOUNT, dir: env.CODEX_HOME ?? join(homedir(), '.codex'), global: true, agent: CODEX }
    this.setRoots(root, codexRoot, openCodeRoot, copilotRoot)
  }

  /** The folders under the new roots count from the next `list`: `EVEN_KEEL_ACCOUNTS_DIR` changes on the fly. */
  setRoots(root: string, codexRoot: string, openCodeRoot: string = openCodeAccountsRoot(this.env), copilotRoot: string = copilotAccountsRoot(this.env)): void {
    this.roots = { [CLAUDE]: root, [CODEX]: codexRoot, [OPENCODE]: openCodeRoot, [COPILOT]: copilotRoot }
  }

  list(): AccountHome[] {
    const claude = this.folders(CLAUDE)
    const codex = this.folders(CODEX).filter((name) => !claude.includes(name))
    const openCode = this.folders(OPENCODE).filter((name) => !claude.includes(name) && !codex.includes(name))
    const copilot = this.folders(COPILOT).filter((name) => !claude.includes(name) && !codex.includes(name) && !openCode.includes(name))
    return [
      ...(existsSync(this.global.dir) ? [this.global] : []),
      ...claude.map((name) => this.home(CLAUDE, name)),
      ...(existsSync(this.codex.dir) ? [this.codex] : []),
      ...codex.map((name) => this.home(CODEX, name)),
      ...openCode.map((name) => this.home(OPENCODE, name)),
      ...copilot.map((name) => this.home(COPILOT, name)),
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
   * `codex login --with-api-key` writes it (BTN-177). OpenCode's: an `auth.json` under the provider the key is of (BTN-214).
   * Copilot's: the GitHub token in `even-keel.json` (BTN-215).
   */
  addApiKey(name: string, key: string, agent: string = CLAUDE): AccountHome {
    const value = assertApiKey(key, agent)
    const home = this.home(agent, folderName(name.trim() === '' ? (agent === COPILOT ? 'github' : 'api') : name, this.taken()))
    mkdirSync(home.dir, { recursive: true })
    if (agent === COPILOT) {
      writeToken(home.dir, value)
      return home
    }
    if (agent === OPENCODE) {
      writeKey(home.dir, value)
      return home
    }
    if (agent === CODEX) {
      writeFileSync(join(home.dir, CODEX_AUTH), JSON.stringify({ auth_mode: 'apikey', [CODEX_KEY_FIELD]: value }, null, 2))
      return home
    }
    writeFileSync(join(home.dir, 'settings.json'), JSON.stringify({ env: { [API_KEY_VARIABLE]: value } }, null, 2))
    const approved = { customApiKeyResponses: { approved: [value.slice(-APPROVED_SUFFIX)], rejected: [] } }
    writeFileSync(join(home.dir, '.claude.json'), JSON.stringify(approved, null, 2))
    return home
  }

  /**
   * The trimmed key that may take the place of the folder's own (BTN-418): of the right form, into a folder that holds its
   * key itself — not the agent's own folder, not one with `apiKeyHelper` — and of the provider of the key it holds.
   */
  replacement(home: AccountHome, key: string): string {
    const value = assertApiKey(key, home.agent)
    const held = home.global ? null : this.apiKeyOf(home)
    if (held === null) throw fail('account.keyNotHeld', { agent: home.agent })
    const provider = keyProvider(home.agent, held)
    if (keyProvider(home.agent, value) !== provider) throw fail('account.keyOtherProvider', { provider })
    return value
  }

  /**
   * A new key in the place of the folder's own, the rest of its files as they are: Claude's `settings.json` and the
   * approval in `.claude.json` (the old key's suffix goes), Codex's `auth.json`, OpenCode's provider entry, Copilot's token.
   */
  replaceApiKey(home: AccountHome, key: string): void {
    const held = this.apiKeyOf(home)
    const value = this.replacement(home, key)
    if (home.agent === COPILOT) return writeToken(home.dir, value)
    if (home.agent === OPENCODE) return replaceKey(home.dir, value)
    if (home.agent === CODEX) {
      const file = join(home.dir, CODEX_AUTH)
      writeFileSync(file, JSON.stringify({ ...readObject(file), [CODEX_KEY_FIELD]: value }, null, 2))
      return
    }
    const settingsFile = join(home.dir, 'settings.json')
    const settings = readObject(settingsFile)
    writeFileSync(settingsFile, JSON.stringify({ ...settings, env: { ...objectOf(settings.env), [API_KEY_VARIABLE]: value } }, null, 2))
    const configFile = this.configFile(home)
    const config = readObject(configFile)
    const responses = objectOf(config.customApiKeyResponses)
    const approved = (Array.isArray(responses.approved) ? responses.approved : []).filter((suffix) => suffix !== held?.slice(-APPROVED_SUFFIX))
    const rejected = Array.isArray(responses.rejected) ? responses.rejected : []
    const customApiKeyResponses = { ...responses, approved: [...approved, value.slice(-APPROVED_SUFFIX)], rejected }
    writeFileSync(configFile, JSON.stringify({ ...config, customApiKeyResponses }, null, 2))
  }

  /** The key in Claude's `settings.json`, Codex's or OpenCode's `auth.json`; a folder with `apiKeyHelper` has none to read. */
  apiKeyOf(home: AccountHome): string | null {
    if (home.agent === OPENCODE) return keyOf(home.dir)
    if (home.agent === COPILOT) return tokenOf(home.dir)
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

/** A JSON object file; an empty object for one missing, broken or holding something else. */
function readObject(file: string): Record<string, unknown> {
  try {
    return objectOf(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return {}
  }
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The trimmed key, or a refusal of one that is not a single word long enough to approve. */
export function assertApiKey(key: string, agent: string = CLAUDE): string {
  const value = key.trim()
  if (agent === COPILOT) {
    if (!API_KEY_PATTERN.test(value) || !COPILOT_TOKEN.test(value)) throw fail('account.copilotTokenInvalid', {})
    return value
  }
  if (!API_KEY_PATTERN.test(value)) throw fail(agent === CODEX ? 'account.codexKeyInvalid' : 'account.apiKeyInvalid', {})
  return value
}

/**
 * The tokens Copilot CLI takes: a fine-grained personal one (`github_pat_`) or an OAuth one of an app (`gho_`, `ghu_`);
 * a classic `ghp_` is refused by the CLI.
 */
const COPILOT_TOKEN = /^(github_pat_|gho_|ghu_)/

/** Whose key an API account of the agent holds: Codex's is OpenAI's, OpenCode's either, by its prefix, Copilot's GitHub's. */
export function keyProvider(agent: string, key: string): 'anthropic' | 'openai' | 'github' {
  if (agent === COPILOT) return 'github'
  if (agent === OPENCODE) return keyVendor(key)
  return agent === CODEX ? 'openai' : 'anthropic'
}

export function accountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_ACCOUNTS_DIR ?? join(homedir(), '.claude-accounts')
}

export function codexAccountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_CODEX_ACCOUNTS_DIR ?? join(homedir(), '.codex-accounts')
}

/** OpenCode has no folder of its own to stand for an account: every one of them is under this root. */
export function openCodeAccountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_OPENCODE_ACCOUNTS_DIR ?? join(homedir(), '.opencode-accounts')
}

/** Copilot's own `~/.copilot` is not an account here: its sign-in is the OS's, shared by every folder (BTN-215). */
export function copilotAccountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_COPILOT_ACCOUNTS_DIR ?? join(homedir(), '.copilot-accounts')
}
