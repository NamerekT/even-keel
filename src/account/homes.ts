import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE } from '../claude/name.js'
import { fail } from '../notice/notice.js'
import { samePath } from '../paths.js'
import { folderName, GLOBAL_ACCOUNT, parseCredentialTimes, type CredentialTimes } from './model.js'
import { API_KEY_VARIABLE, shareConfig } from './share.js'

const PENDING_PREFIX = '.pending-'
const LOCK_SUFFIX = '.lock'
const APPROVED_SUFFIX = 20
const API_KEY_PATTERN = new RegExp(`^\\S{${APPROVED_SUFFIX + 1},}$`)

export interface AccountHome {
  key: string
  dir: string
  global: boolean
  /** The agent the folder is an account of; its sessions run on that agent (`src/agent/adapters.ts`). */
  agent: string
}

/** The account folders of Claude Code: the global `~/.claude` and one `CLAUDE_CONFIG_DIR` per account under the root. */
export class AccountHomes {
  readonly global: AccountHome

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly root: string,
  ) {
    this.global = { key: GLOBAL_ACCOUNT, dir: env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), global: true, agent: CLAUDE }
  }

  list(): AccountHome[] {
    return [this.global, ...this.folders().map((name) => this.home(name))]
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

  pending(now: Date): AccountHome {
    const name = `${PENDING_PREFIX}${now.getTime().toString(36)}`
    mkdirSync(join(this.root, name), { recursive: true })
    return { key: name, dir: join(this.root, name), global: false, agent: CLAUDE }
  }

  place(pending: AccountHome, email: string | null): AccountHome {
    const name = folderName(email, this.folders())
    renameSync(pending.dir, join(this.root, name))
    return this.home(name)
  }

  /**
   * An API account: a folder whose `settings.json` carries the key (`mergeSettings` keeps it there) and whose
   * `.claude.json` has it approved, or the CLI asks whether to use it (BTN-136).
   */
  addApiKey(name: string, key: string): AccountHome {
    const value = assertApiKey(key)
    const home = this.home(folderName(name.trim() === '' ? 'api' : name, this.folders()))
    mkdirSync(home.dir, { recursive: true })
    writeFileSync(join(home.dir, 'settings.json'), JSON.stringify({ env: { [API_KEY_VARIABLE]: value } }, null, 2))
    const approved = { customApiKeyResponses: { approved: [value.slice(-APPROVED_SUFFIX)], rejected: [] } }
    writeFileSync(join(home.dir, '.claude.json'), JSON.stringify(approved, null, 2))
    return home
  }

  /** The key in the folder's `settings.json`; a folder with `apiKeyHelper` has none to read. */
  apiKeyOf(home: AccountHome): string | null {
    try {
      const key = JSON.parse(readFileSync(join(home.dir, 'settings.json'), 'utf8'))?.env?.[API_KEY_VARIABLE]
      return typeof key === 'string' && key !== '' ? key : null
    } catch {
      return null
    }
  }

  share(home: AccountHome): boolean {
    if (home.global) return false
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

  private home(name: string): AccountHome {
    return { key: name, dir: join(this.root, name), global: false, agent: CLAUDE }
  }

  private folders(): string[] {
    try {
      return readdirSync(this.root, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith(LOCK_SUFFIX) && entry.name !== GLOBAL_ACCOUNT,
        )
        .map((entry) => entry.name)
        .sort()
    } catch {
      return []
    }
  }
}

/** The trimmed key, or a refusal of one that is not a single word long enough to approve. */
export function assertApiKey(key: string): string {
  const value = key.trim()
  if (!API_KEY_PATTERN.test(value)) throw fail('account.apiKeyInvalid', {})
  return value
}

export function accountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_ACCOUNTS_DIR ?? join(homedir(), '.claude-accounts')
}
