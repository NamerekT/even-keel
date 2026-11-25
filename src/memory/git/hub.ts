import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runGit } from '../../git/run.js'
import type { Git } from '../../git/types.js'
import { fail } from '../../notice/notice.js'
import type { ConfigConflictView } from '../../state.js'
import type { Queryable } from '../../storage/database.js'
import { folderRecords } from '../files.js'
import { indexLine } from '../record.js'
import { WorkingCopies } from './copies.js'
import { CONFIG_REPOSITORY, ConfigCopy } from './config-copy.js'
import { RemoteMirror } from './remote-mirror.js'
import { MEMORY_BRANCH, type MemorySyncDeps } from './sync.js'
import { transferRecords } from './transfer.js'

export { memoryDirOf } from '../../storage/owner.js'

export interface MemoryHubDeps {
  db: Queryable
  /** `memoryDirOf` the state database's folder. */
  dir: string
  /** Each project's memory folders on the hub by its id; the first is the one the memory tools work in. */
  folders(): Record<string, string[]>
  /** Who the hub's commits are by. */
  author: string
  log(line: string): void
  /** The `memoryMirror` setting now (BTN-1649); absent or `null` — no mirror. */
  mirror?(): string | null
  git?: Git
  schedule?: MemorySyncDeps['schedule']
  watch?: MemorySyncDeps['watch']
  /** The global folder whose configuration the hub keeps as its copy of the `config` repository (BTN-1690); absent — none. */
  globalDir?: string
  /** The configuration copy wrote its conflicts: the page's banner may change (BTN-1692). */
  conflictsSaved?(): void
}

/**
 * The hub's side of the project memory in git (BTN-1646, `docs/sessions/memory.md`): a bare repository per project,
 * `<id>.git` in the state database's folder, and the project's memory folders on the hub kept as its working copies by
 * a `MemorySync` each. Before a project's first sync its `memory_records` go into its folder once (`transferRecords`).
 * The copies themselves are `WorkingCopies`, as a machine's are. Every push into a project's repository, from a copy
 * of the hub's or a machine's, is followed by one into the memory mirror, when one is set (`RemoteMirror`). The global
 * configuration is one more repository among them, `config.git` (`CONFIG_REPOSITORY`, BTN-1690), with the hub's
 * `ConfigCopy` as its working copy and the mirror's branch `config`.
 */
export class MemoryHub {
  private readonly copies: WorkingCopies
  private readonly mirror: RemoteMirror
  private config: ConfigCopy | null = null
  private configStarting: Promise<void> | null = null
  private stopped = false

  constructor(private readonly deps: MemoryHubDeps) {
    this.copies = new WorkingCopies({
      folders: () => deps.folders(),
      remoteOf: (project) => this.repositoryOf(project),
      prepare: (project, folder) => this.prepare(project, folder),
      pushed: (project) => this.pushed(project),
      author: deps.author,
      log: deps.log,
      git: deps.git,
      schedule: deps.schedule,
      watch: deps.watch,
    })
    this.mirror = new RemoteMirror({
      address: () => deps.mirror?.() ?? null,
      repositoryOf: (project) => this.repositoryOf(project),
      projects: () => [...Object.keys(deps.folders()), CONFIG_REPOSITORY].filter((project) => existsSync(this.repositoryOf(project))),
      log: deps.log,
      git: deps.git,
    })
  }

  repositoryOf(project: string): string {
    return join(this.deps.dir, `${project}.git`)
  }

  /** The project's bare repository if it is made; `null` — not yet (`apply` makes it with the project's first copy). */
  existingRepository(project: string): string | null {
    const repository = this.repositoryOf(project)
    return existsSync(repository) ? repository : null
  }

  /** The projects' folders as `folders` gives them now: new ones synced, gone ones left. One apply runs at a time. */
  apply(): Promise<void> {
    const run = Promise.all([this.copies.apply(), this.startConfig()]).then(() => undefined)
    void run.catch(() => {}).then(() => (this.stopped ? undefined : this.mirror.apply()))
    return run
  }

  /** The hub's copy of the global configuration, once: its repository made, then the copy's first sync begun. */
  private startConfig(): Promise<void> {
    const globalDir = this.deps.globalDir
    if (globalDir === undefined) return Promise.resolve()
    this.configStarting ??= this.makeRepository(CONFIG_REPOSITORY).then(
      () => {
        if (this.stopped) return
        const deps = this.deps
        this.config = new ConfigCopy({
          globalDir,
          remote: this.repositoryOf(CONFIG_REPOSITORY),
          author: deps.author,
          log: deps.log,
          pushed: () => this.pushed(CONFIG_REPOSITORY),
          ...(deps.conflictsSaved !== undefined && { conflictsSaved: deps.conflictsSaved }),
          ...(deps.git !== undefined && { git: deps.git }),
          ...(deps.schedule !== undefined && { schedule: deps.schedule }),
          ...(deps.watch !== undefined && { watch: deps.watch }),
        })
        void this.config.start()
      },
      (error: unknown) => {
        this.configStarting = null
        this.deps.log(`config: no repository: ${(error as Error).message}`)
      },
    )
    return this.configStarting
  }

  /** A push brought the project's repository new commits: from a working copy of the hub's or a machine's. */
  pushed(project: string): void {
    void this.mirror.push(project)
  }

  /** The page's warning while the memory mirror is set. */
  mirrorView(): ReturnType<RemoteMirror['view']> {
    return this.mirror.view()
  }

  /**
   * The global configuration's conflicts a person settles (BTN-1692), met here or on any machine: a machine's sync
   * pushes its conflict into the repository, and the hub's copy syncs after each push.
   */
  configConflicts(): ConfigConflictView[] {
    return this.config?.conflicts() ?? []
  }

  /** "Keep this" or "Take the other" of the banner: a commit of the hub's copy that ends the conflict everywhere. */
  async settleConfig(file: string, hash: string, take: 'kept' | 'other'): Promise<void> {
    if (this.config === null || !(await this.config.settle(file, hash, take))) throw fail('config.conflictGone', { file })
  }

  stop(): void {
    this.stopped = true
    this.copies.stop()
    this.config?.stop()
  }

  /** The folder the memory tools work in; `null` — the hub has none for the project. */
  folderOf(project: string): string | null {
    return this.copies.primary(project)?.folder ?? this.deps.folders()[project]?.[0] ?? null
  }

  /**
   * A step of the memory tools on the project's folder, between its syncs; a sync follows a step that wrote. Without a
   * working copy (git failed for it) the step runs at once.
   */
  async within<T>(project: string, step: (folder: string | null) => T, wrote = false): Promise<T> {
    const copy = this.copies.primary(project)
    if (copy === undefined) return step(this.folderOf(project))
    const result = await copy.sync.edit(() => step(copy.folder))
    if (wrote) void copy.sync.sync()
    return result
  }

  /** The index lines of the project's records for a chain session's prompt. */
  index(project: string): Promise<string[]> {
    return this.within(project, (folder) => (folder === null ? [] : folderRecords(folder).map(indexLine)))
  }

  /** A sync of every working copy now, or of the project's only (a machine pushed into its repository, BTN-1648). */
  syncAll(project?: string): Promise<unknown> {
    if (project === CONFIG_REPOSITORY) return this.config?.syncNow() ?? Promise.resolve()
    if (project !== undefined) return this.copies.syncAll(project)
    return Promise.allSettled([this.copies.syncAll(), this.config?.syncNow()])
  }

  /** The project's records into its main folder once, then its bare repository. */
  private async prepare(project: string, folder: string): Promise<void> {
    await transferRecords(this.deps.db, project, folder, this.deps.log)
    await this.makeRepository(project)
  }

  /** The repository, made whole or not at all. */
  private async makeRepository(project: string): Promise<void> {
    const repository = this.repositoryOf(project)
    if (existsSync(repository)) return
    mkdirSync(this.deps.dir, { recursive: true })
    const draft = `${repository}.new`
    rmSync(draft, { recursive: true, force: true })
    const git = this.deps.git ?? runGit
    const made = await git(this.deps.dir, ['init', '--bare', '-q', '-b', MEMORY_BRANCH, draft])
    if (made.code !== 0) {
      rmSync(draft, { recursive: true, force: true })
      throw new Error(`git init: ${made.out}`)
    }
    const seeded = await this.seed(git, project, draft)
    renameSync(draft, repository)
    this.deps.log(`memory: ${project} has a new repository ${repository}${seeded ? ', its history taken from the mirror' : ''}`)
  }

  /**
   * A new repository takes the project's branch of the memory mirror when there is one (BTN-1674): the working copies'
   * history then lands on the one it came from and the mirror goes on moving forward. None or unreachable — it stays
   * empty, and the first copy with a history pushes it.
   */
  private async seed(git: Git, project: string, draft: string): Promise<boolean> {
    const address = this.deps.mirror?.() ?? null
    if (address === null || address.startsWith('-')) return false
    const fetched = await git(draft, ['fetch', '-q', address, `+refs/heads/${project}:refs/heads/${MEMORY_BRANCH}`], { GCM_INTERACTIVE: 'never' })
    if (fetched.code === 0) return true
    if (!/couldn't find remote ref/i.test(fetched.out)) this.deps.log(`memory: ${project} takes no history from the mirror: ${fetched.out.split('\n')[0]}`)
    return false
  }
}
