import { readFileSync, watch as watchFolder } from 'node:fs'
import { join } from 'node:path'
import { linkAgentSkills } from '../../account/agent-skills.js'
import { configStore, settleStores } from '../../account/share.js'
import { notice } from '../../notice/notice.js'
import type { ConfigConflictView } from '../../state.js'
import { CONFIG_FILES, ConfigFiles } from './config-files.js'
import { pendingConflicts } from './conflicts.js'
import { MemorySync, type MemorySyncDeps, type SyncOutcome } from './sync.js'

/** The repository id of the global configuration among the projects' memory repositories (BTN-1690). */
export const CONFIG_REPOSITORY = 'config'

/** Of each version of a conflict, this much goes to the page: the banner's tip shows it whole. */
export const CONFIG_CONFLICT_TEXT = 16 * 1024

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
  /** Its conflicts file was written: `conflicts` may say otherwise now. */
  conflictsSaved?(): void
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
      conflictsSaved: deps.conflictsSaved,
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

  /** The open conflicts a person settles, as the page shows them (BTN-1692). */
  conflicts(): ConfigConflictView[] {
    return pendingConflicts(this.folder)
      .filter((conflict) => conflict.human === true)
      .map((conflict) => ({
        file: conflict.file,
        machine: conflict.by ?? null,
        since: conflict.since,
        notice:
          conflict.by === undefined
            ? notice('memory.configConflictAnywhere', { file: conflict.file })
            : notice('memory.configConflict', { file: conflict.file, machine: conflict.by }),
        hash: conflict.hash,
        kept: cut(readFileSync(join(this.folder, conflict.file), 'utf8')),
        other: cut(conflict.otherText),
      }))
  }

  /** A person's choice for a conflict of `conflicts` (`MemorySync.settle`); `false` — it is settled or changed already. */
  settle(file: string, hash: string, take: 'kept' | 'other'): Promise<boolean> {
    return this.sync.settle(file, hash, take)
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

function cut(text: string): string {
  return text.length > CONFIG_CONFLICT_TEXT ? `${text.slice(0, CONFIG_CONFLICT_TEXT)}\n[…]` : text
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
