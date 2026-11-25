import { watch as watchFolder } from 'node:fs'
import { linkAgentSkills } from '../../account/agent-skills.js'
import { configStore, settleStores } from '../../account/share.js'
import { CONFIG_FILES, ConfigFiles } from './config-files.js'
import { MemorySync, type MemorySyncDeps, type SyncOutcome } from './sync.js'

/** The repository id of the global configuration among the projects' memory repositories (BTN-1690). */
export const CONFIG_REPOSITORY = 'config'

export interface ConfigCopyDeps {
  /** The global folder, `~/.claude`. */
  globalDir: string
  /** The configuration repository as git reaches it from here: a path on the hub, the link's relay on a machine. */
  remote: string
  author: string
  log(line: string): void
  git?: MemorySyncDeps['git']
  schedule?: MemorySyncDeps['schedule']
  /** Watches both the copy and the global folder; `(folder, changed, nested)`. */
  watch?: MemorySyncDeps['watch']
  pushed?(): void
}

/**
 * The user's global configuration kept as a working copy of the configuration repository on the hub and on every
 * machine (BTN-1690, `docs/sessions/memory.md`): `configStore` synced by a `MemorySync` of kind `config`, with
 * `CLAUDE.md` and `settings.json` of the global folder carried in and out of it by `ConfigFiles`. The stores of before
 * the config store are moved into it first (`settleStores`), and its skills are linked into `~/.agents/skills`.
 */
export class ConfigCopy {
  readonly folder: string
  private readonly sync: MemorySync
  private unwatch: (() => void) | null = null

  constructor(private readonly deps: ConfigCopyDeps) {
    this.folder = configStore(deps.globalDir)
    const files = new ConfigFiles({ globalDir: deps.globalDir, folder: this.folder, log: deps.log })
    this.sync = new MemorySync({
      kind: 'config',
      folder: this.folder,
      remote: deps.remote,
      author: deps.author,
      log: deps.log,
      git: deps.git,
      schedule: deps.schedule,
      watch: deps.watch,
      pushed: deps.pushed,
      beforeCommit: () => files.takeIn(),
      afterSync: () => {
        files.giveOut()
        this.linkSkills()
      },
    })
  }

  start(): Promise<SyncOutcome> {
    settleStores(this.deps.globalDir, (line) => this.deps.log(line))
    this.linkSkills()
    try {
      this.unwatch = (this.deps.watch ?? watchGlobal)(this.deps.globalDir, () => this.sync.touched(), false)
    } catch (error) {
      this.deps.log(`config: ${this.deps.globalDir} cannot be watched, its CLAUDE.md and settings.json sync with the next sync: ${(error as Error).message}`)
    }
    return this.sync.start()
  }

  /** A sync now: a push from elsewhere, the link back. */
  syncNow(): Promise<SyncOutcome> {
    return this.sync.sync()
  }

  /** The store's skills for Codex, Copilot and OpenCode, at the start and after every sync (`linkAgentSkills`). */
  private linkSkills(): void {
    try {
      linkAgentSkills(this.deps.globalDir, this.deps.log)
    } catch (error) {
      this.deps.log(`skills: ~/.agents/skills not linked: ${(error as Error).message}`)
    }
  }

  stop(): void {
    this.unwatch?.()
    this.unwatch = null
    this.sync.stop()
  }
}

/** The global folder's own files only: everything else in it is the CLI's. */
function watchGlobal(folder: string, changed: () => void): () => void {
  const names = new Set<string>(CONFIG_FILES)
  const watcher = watchFolder(folder, (_event, name) => {
    if (name !== null && names.has(name)) changed()
  })
  watcher.on('error', () => watcher.close())
  return () => watcher.close()
}
