import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { samePath } from '../paths.js'
import { trackerVariables } from '../tracker/adapters.js'
import { folderName, GLOBAL_ACCOUNT, parseCredentialTimes, type CredentialTimes } from './model.js'
import { shareConfig } from './share.js'

const PENDING_PREFIX = '.pending-'
const LOCK_SUFFIX = '.lock'

export interface AccountHome {
  key: string
  dir: string
  global: boolean
}

export class AccountHomes {
  readonly global: AccountHome

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly root: string,
  ) {
    this.global = { key: GLOBAL_ACCOUNT, dir: env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), global: true }
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

  envOf(home: AccountHome): NodeJS.ProcessEnv {
    const env = { ...this.env }
    for (const name of trackerVariables()) delete env[name]
    if (!home.global) env.CLAUDE_CONFIG_DIR = home.dir
    return env
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
    return { key: name, dir: join(this.root, name), global: false }
  }

  place(pending: AccountHome, email: string | null): AccountHome {
    const name = folderName(email, this.folders())
    renameSync(pending.dir, join(this.root, name))
    return this.home(name)
  }

  share(home: AccountHome): boolean {
    if (home.global) return false
    const config = this.env.CLAUDE_CONFIG_DIR === undefined ? join(homedir(), '.claude.json') : join(this.global.dir, '.claude.json')
    return shareConfig({ dir: this.global.dir, config }, home.dir)
  }

  remove(home: AccountHome): void {
    if (home.global) throw new Error('claude: the global account folder is not removed from here')
    rmSync(home.dir, { recursive: true, force: true, maxRetries: 3 })
  }

  private home(name: string): AccountHome {
    return { key: name, dir: join(this.root, name), global: false }
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

export function accountsRoot(env: NodeJS.ProcessEnv): string {
  return env.EVEN_KEEL_ACCOUNTS_DIR ?? join(homedir(), '.claude-accounts')
}
