import { readFileSync, watchFile } from 'node:fs'
import { parseEnv } from 'node:util'
import { TALLY_DATABASE } from './stats/mode.js'

export interface EnvFileOptions {
  file: string
  /** The environment the file goes into: `process.env`. */
  env: Record<string, string | undefined>
  intervalMs: number
  warn: (message: string) => void
}

/** Who reads a changed variable: what the service sets up again once the file changed. */
export interface EnvTargets {
  /** `EVEN_KEEL_TOKEN`, and the address: whether a token is required depends on the host. */
  guard: boolean
  listen: boolean
  /** The database of the stats; the collector reads the rest of `TALLY_*` itself at each pass. */
  tally: boolean
  accounts: boolean
}

const LISTEN = ['EVEN_KEEL_HOST', 'EVEN_KEEL_PORT']
const ACCOUNTS = ['EVEN_KEEL_ACCOUNTS_DIR', 'EVEN_KEEL_CODEX_ACCOUNTS_DIR', 'EVEN_KEEL_OPENCODE_ACCOUNTS_DIR']

/**
 * Even Keel's `.env`, watched like the config: a change goes into the environment at once. As `process.loadEnvFile` at
 * the start, a variable the process got from outside stays as it was, whatever the file says.
 */
export class EnvFile {
  /** The file's variables as last read. */
  current: Record<string, string>
  private readonly outer: ReadonlySet<string>
  private readonly listeners = new Set<(changed: string[]) => void>()

  constructor(private readonly options: EnvFileOptions) {
    this.outer = new Set(Object.keys(options.env))
    this.current = this.read()
    for (const [name, value] of Object.entries(this.current)) if (!this.outer.has(name)) options.env[name] = value
  }

  /** The process got the variable from outside: whatever the file says does not reach it. */
  isOuter(name: string): boolean {
    return this.outer.has(name)
  }

  /** `listener` gets the variables whose value the file changed, sorted. */
  subscribe(listener: (changed: string[]) => void): void {
    this.listeners.add(listener)
  }

  watch(): void {
    watchFile(this.options.file, { interval: this.options.intervalMs, persistent: false }, (now, before) => {
      if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) this.reload()
    })
  }

  reload(): void {
    let next: Record<string, string>
    try {
      next = this.read()
    } catch (error) {
      this.options.warn(`env: ${this.options.file} is not applied: ${(error as Error).message}`)
      return
    }
    const changed = envChanges(this.current, next, this.outer)
    this.current = next
    if (changed.length === 0) return
    for (const name of changed) {
      if (Object.hasOwn(next, name)) this.options.env[name] = next[name]
      else delete this.options.env[name]
    }
    for (const listener of this.listeners) listener(changed)
  }

  private read(): Record<string, string> {
    let text: string
    try {
      text = readFileSync(this.options.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
    return { ...parseEnv(text) } as Record<string, string>
  }
}

/** The variables the file added, changed or removed, sorted; those of `outer` — set from outside — are not the file's. */
export function envChanges(before: Record<string, string>, after: Record<string, string>, outer: ReadonlySet<string>): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...names].filter((name) => !outer.has(name) && before[name] !== after[name]).sort()
}

/**
 * The trackers' variables and the Forgejo token are not here: their credentials are the profiles' (BTN-200, BTN-201),
 * `.env` is not read for them.
 */
export function envTargets(changed: readonly string[]): EnvTargets {
  const has = (names: readonly string[]) => changed.some((name) => names.includes(name))
  const listen = has(LISTEN)
  return {
    guard: listen || has(['EVEN_KEEL_TOKEN']),
    listen,
    tally: changed.some((name) => TALLY_DATABASE.test(name)),
    accounts: has(ACCOUNTS),
  }
}
