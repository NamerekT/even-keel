import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileHash } from '../record.js'

/** The files of the global folder whose copies the configuration repository keeps (BTN-1690). */
export const CONFIG_FILES = ['CLAUDE.md', 'settings.json'] as const
type ConfigFile = (typeof CONFIG_FILES)[number]

/**
 * Keys of `settings.json` each machine keeps its own (BTN-1707): `env`, and those holding a machine's absolute paths —
 * hook commands, the status line, a marketplace's folder. The hook files themselves travel; their registration does not.
 */
export const MACHINE_SETTINGS: readonly string[] = ['env', 'hooks', 'statusLine', 'extraKnownMarketplaces']

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
  /** The machine keeps its own `CLAUDE.md` and `settings.json` now (BTN-1745): neither goes in or out. */
  apart?(): boolean
}

/**
 * A file of the global folder that meets the copy's with no exchange between them (BTN-1745): the copy follows the
 * network while the machine keeps its own, so after the switch is off the two are versions with no common one.
 */
export interface Meeting {
  file: ConfigFile
  /** The global folder's file as the copy would hold it: `settings.json` without its `MACHINE_SETTINGS`. */
  text: string
  /** When the global folder's file was last written. */
  time: Date
  /** The meeting is in the copy's history: from now on the two are exchanged as usual. */
  joined(): void
}

/**
 * `CLAUDE.md` and `settings.json` live in the global folder, where the CLI reads them; the configuration's working copy
 * keeps copies of them (BTN-1690, `docs/sessions/memory.md`). `takeIn` runs before a sync's commit: a file edited in the
 * global folder since the last exchange goes into the copy. `giveOut` runs after the sync: a copy the sync changed goes
 * back, unless the global file was edited meanwhile (the next sync takes that in). `settings.json` travels without its
 * `MACHINE_SETTINGS`: each machine keeps its own. A deletion travels in neither direction.
 */
export class ConfigFiles {
  private readonly told = new Set<string>()

  constructor(private readonly deps: ConfigFilesDeps) {}

  takeIn(): void {
    const state = this.state()
    if (this.deps.apart?.() === true) {
      // Nothing is exchanged while apart, and nothing is remembered: once the switch is off the files meet (`meetings`).
      if (CONFIG_FILES.some((file) => state[file] !== undefined)) this.save({})
      return
    }
    let changed = false
    for (const file of CONFIG_FILES) {
      const live = readText(join(this.deps.globalDir, file))
      if (live === null) continue
      if (state[file] === undefined && existsSync(join(this.deps.folder, file))) continue
      const liveHash = fileHash(live)
      if (state[file]?.live === liveHash) {
        if (file === 'settings.json' && this.dropLocalFromCopy(state)) changed = true
        continue
      }
      const copy = file === 'settings.json' ? this.sharedSettings(live, this.deps.globalDir) : live
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
    if (this.deps.apart?.() === true) return
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
      // A global file never exchanged with the copy is never replaced by it: it meets it (`meetings`), or is not JSON.
      if (live !== null && (last === undefined || fileHash(live) !== last.live)) continue
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

  /**
   * The global files that meet the copy's own with no exchange between them yet — the switch turned off (BTN-1745):
   * each differing one for the sync to settle as a first meeting; an equal one is joined at once.
   */
  meetings(): Meeting[] {
    if (this.deps.apart?.() === true) return []
    const state = this.state()
    const met: Meeting[] = []
    for (const file of CONFIG_FILES) {
      if (state[file] !== undefined) continue
      const path = join(this.deps.globalDir, file)
      const live = readText(path)
      const copy = readText(join(this.deps.folder, file))
      if (live === null || copy === null) continue
      const text = file === 'settings.json' ? this.sharedSettings(live, this.deps.globalDir) : live
      if (text === null) continue
      const joined = () => {
        const now = this.state()
        now[file] = { live: fileHash(live), copy: fileHash(text) }
        this.save(now)
      }
      if (text === copy) joined()
      else met.push({ file, text, time: statSync(path).mtime, joined })
    }
    return met
  }

  /** `settings.json` as the copy keeps it: without the machine-local keys, two spaces, a newline at the end. */
  private sharedSettings(text: string, dir: string): string | null {
    const settings = this.parse(text, join(dir, 'settings.json'))
    if (settings === null) return null
    const shared = Object.fromEntries(Object.entries(settings).filter(([key]) => !MACHINE_SETTINGS.includes(key)))
    return `${JSON.stringify(shared, null, 2)}\n`
  }

  /**
   * A copy still holding machine-local keys, written by a build of before BTN-1707 while the global file has not changed
   * since, loses them: otherwise they would stay in the network until the global file is next edited.
   */
  private dropLocalFromCopy(state: State): boolean {
    const path = join(this.deps.folder, 'settings.json')
    const copy = readText(path)
    if (copy === null) return false
    const copyHash = fileHash(copy)
    if (state['settings.json']?.copy !== copyHash) return false
    const shared = this.sharedSettings(copy, this.deps.folder)
    if (shared === null || shared === copy) return false
    writeFileSync(path, shared)
    state['settings.json'] = { live: state['settings.json'].live, copy: fileHash(shared) }
    return true
  }

  /** The copy's `settings.json` with the global one's own machine-local keys. */
  private ownSettings(copy: string, live: string | null): string | null {
    const settings = this.parse(copy, join(this.deps.folder, 'settings.json'))
    if (settings === null) return null
    const own = live === null ? null : this.parse(live, join(this.deps.globalDir, 'settings.json'))
    const out: Json = {}
    for (const [key, value] of Object.entries(settings)) if (!MACHINE_SETTINGS.includes(key)) out[key] = value
    for (const key of MACHINE_SETTINGS) if (own?.[key] !== undefined) out[key] = own[key]
    return `${JSON.stringify(out, null, 2)}\n`
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
