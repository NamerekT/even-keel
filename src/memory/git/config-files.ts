import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileHash } from '../record.js'

/** The files of the global folder whose copies the configuration repository keeps (BTN-1690). */
export const CONFIG_FILES = ['CLAUDE.md', 'settings.json'] as const
type ConfigFile = (typeof CONFIG_FILES)[number]

/** What the last exchange left on both sides, by file: the hash of the global folder's file and of the copy's. */
const STATE_FILE = join('.git', 'even-keel-config-files.json')

type Json = Record<string, unknown>
type State = Partial<Record<ConfigFile, { live: string; copy: string }>>

export interface ConfigFilesDeps {
  /** The global folder, `~/.claude`. */
  globalDir: string
  /** The configuration's working copy, `configStore`. */
  folder: string
  log(line: string): void
}

/**
 * `CLAUDE.md` and `settings.json` live in the global folder, where the CLI reads them; the configuration's working copy
 * keeps copies of them (BTN-1690, `docs/sessions/memory.md`). `takeIn` runs before a sync's commit: a file edited in the
 * global folder since the last exchange goes into the copy. `giveOut` runs after the sync: a copy the sync changed goes
 * back, unless the global file was edited meanwhile (the next sync takes that in). `settings.json` travels without its
 * `env`: each machine keeps its own. A deletion travels in neither direction.
 */
export class ConfigFiles {
  private readonly told = new Set<string>()

  constructor(private readonly deps: ConfigFilesDeps) {}

  takeIn(): void {
    const state = this.state()
    let changed = false
    for (const file of CONFIG_FILES) {
      const live = readText(join(this.deps.globalDir, file))
      if (live === null) continue
      const liveHash = fileHash(live)
      if (state[file]?.live === liveHash) continue
      const copy = file === 'settings.json' ? this.sharedSettings(live) : live
      if (copy === null) continue
      const path = join(this.deps.folder, file)
      if (readText(path) !== copy) {
        mkdirSync(this.deps.folder, { recursive: true })
        writeFileSync(path, copy)
      }
      state[file] = { live: liveHash, copy: fileHash(copy) }
      changed = true
    }
    if (changed) this.save(state)
  }

  giveOut(): void {
    const state = this.state()
    let changed = false
    for (const file of CONFIG_FILES) {
      const copy = readText(join(this.deps.folder, file))
      if (copy === null) continue
      const copyHash = fileHash(copy)
      const last = state[file]
      if (last?.copy === copyHash) continue
      const path = join(this.deps.globalDir, file)
      const live = readText(path)
      if (live !== null && last !== undefined && fileHash(live) !== last.live) continue
      const out = file === 'settings.json' ? this.ownSettings(copy, live) : copy
      if (out === null) continue
      if (out !== live) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, out)
        this.deps.log(`config: ${path} took the network's version`)
      }
      state[file] = { live: fileHash(out), copy: copyHash }
      changed = true
    }
    if (changed) this.save(state)
  }

  /** The global `settings.json` as the copy keeps it: without `env`, two spaces, a newline at the end. */
  private sharedSettings(text: string): string | null {
    const settings = this.parse(text, join(this.deps.globalDir, 'settings.json'))
    if (settings === null) return null
    const { env: _env, ...shared } = settings
    return `${JSON.stringify(shared, null, 2)}\n`
  }

  /** The copy's `settings.json` with the global one's own `env`. */
  private ownSettings(copy: string, live: string | null): string | null {
    const settings = this.parse(copy, join(this.deps.folder, 'settings.json'))
    if (settings === null) return null
    const { env: _env, ...shared } = settings
    const own = live === null ? null : this.parse(live, join(this.deps.globalDir, 'settings.json'))
    const env = own?.env
    return `${JSON.stringify(env === undefined ? shared : { ...shared, env }, null, 2)}\n`
  }

  private parse(text: string, path: string): Json | null {
    try {
      const value: unknown = JSON.parse(text)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Json
    } catch {
      // Told below.
    }
    const told = `${path}\0${fileHash(text)}`
    if (!this.told.has(told)) {
      this.told.add(told)
      this.deps.log(`config: ${path} is not a JSON object: it is not synced until it is fixed`)
    }
    return null
  }

  private state(): State {
    try {
      const value: unknown = JSON.parse(readFileSync(join(this.deps.folder, STATE_FILE), 'utf8'))
      return typeof value === 'object' && value !== null ? (value as State) : {}
    } catch {
      return {}
    }
  }

  private save(state: State): void {
    const path = join(this.deps.folder, STATE_FILE)
    if (!existsSync(dirname(path))) return
    writeFileSync(path, JSON.stringify(state))
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
