import { existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runGit } from '../../git/run.js'
import type { Git } from '../../git/types.js'
import { pathKey } from '../../paths.js'
import type { Queryable } from '../../storage/database.js'
import { folderRecords } from '../files.js'
import { indexLine } from '../record.js'
import { MEMORY_BRANCH, MemorySync, type MemorySyncDeps } from './sync.js'
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
  git?: Git
  schedule?: MemorySyncDeps['schedule']
  watch?: MemorySyncDeps['watch']
}

interface Copy {
  project: string
  folder: string
  sync: MemorySync
}

/**
 * The hub's side of the project memory in git (BTN-1646, `docs/sessions/memory.md`): a bare repository per project,
 * `<id>.git` in the state database's folder, and the project's memory folders on the hub kept as its working copies by
 * a `MemorySync` each. Before a project's first sync its `memory_records` go into its folder once (`transferRecords`).
 * A folder two projects name is the first one's; the other is told in the log and gets none.
 */
export class MemoryHub {
  private readonly copies = new Map<string, Copy>()
  private applying: Promise<void> = Promise.resolve()
  private readonly told = new Set<string>()
  private stopped = false

  constructor(private readonly deps: MemoryHubDeps) {}

  repositoryOf(project: string): string {
    return join(this.deps.dir, `${project}.git`)
  }

  /** The projects' folders as `folders` gives them now: new ones synced, gone ones left. One apply runs at a time. */
  apply(): Promise<void> {
    const run = this.applying.catch(() => {}).then(() => this.applyNow())
    this.applying = run
    return run
  }

  stop(): void {
    this.stopped = true
    for (const copy of this.copies.values()) copy.sync.stop()
    this.copies.clear()
  }

  /** The folder the memory tools work in; `null` — the hub has none for the project. */
  folderOf(project: string): string | null {
    return this.primary(project)?.folder ?? this.deps.folders()[project]?.[0] ?? null
  }

  /**
   * A step of the memory tools on the project's folder, between its syncs; a sync follows a step that wrote. Without a
   * working copy (git failed for it) the step runs at once.
   */
  async within<T>(project: string, step: (folder: string | null) => T, wrote = false): Promise<T> {
    const copy = this.primary(project)
    if (copy === undefined) return step(this.folderOf(project))
    const result = await copy.sync.edit(() => step(copy.folder))
    if (wrote) void copy.sync.sync()
    return result
  }

  /** The index lines of the project's records for a chain session's prompt. */
  index(project: string): Promise<string[]> {
    return this.within(project, (folder) => (folder === null ? [] : folderRecords(folder).map(indexLine)))
  }

  /** A sync of every working copy now: the link back, or a call that needs the newest files. */
  syncAll(): Promise<unknown> {
    return Promise.allSettled([...this.copies.values()].map((copy) => copy.sync.sync()))
  }

  private primary(project: string): Copy | undefined {
    const first = this.deps.folders()[project]?.[0]
    if (first === undefined) return undefined
    const copy = this.copies.get(this.keyOf(first))
    return copy?.project === project ? copy : undefined
  }

  private keyOf(folder: string): string {
    let real = resolve(folder)
    try {
      real = realpathSync.native(folder)
    } catch {
      // A folder not made yet: its own path.
    }
    return pathKey(real)
  }

  private async applyNow(): Promise<void> {
    if (this.stopped) return
    const wanted = new Map<string, { project: string; folder: string }>()
    for (const [project, folders] of Object.entries(this.deps.folders())) {
      for (const folder of folders) {
        const key = this.keyOf(folder)
        const owner = wanted.get(key)
        if (owner === undefined) wanted.set(key, { project, folder })
        else if (owner.project !== project) this.tellOnce(`${key}\0${project}`, `memory: ${folder} is the memory folder of ${owner.project} already: ${project} gets no working copy there`)
      }
    }
    for (const [key, copy] of this.copies) {
      const want = wanted.get(key)
      if (want !== undefined && want.project === copy.project) continue
      copy.sync.stop()
      this.copies.delete(key)
    }
    const projects = new Map<string, string[]>()
    for (const [key, { project }] of wanted) if (!this.copies.has(key)) projects.set(project, [...(projects.get(project) ?? []), key])
    for (const [project, keys] of projects) {
      const folders = keys.map((key) => wanted.get(key)!.folder)
      try {
        await this.prepare(project, this.deps.folders()[project]?.[0] ?? folders[0]!)
      } catch (error) {
        this.deps.log(`memory: ${project} has no repository: ${(error as Error).message}`)
        continue
      }
      if (this.stopped) return
      for (const key of keys) {
        const folder = wanted.get(key)!.folder
        const sync = new MemorySync({
          folder,
          remote: this.repositoryOf(project),
          author: this.deps.author,
          log: this.deps.log,
          git: this.deps.git,
          schedule: this.deps.schedule,
          watch: this.deps.watch,
        })
        this.copies.set(key, { project, folder, sync })
        void sync.start()
      }
    }
  }

  /** The project's records into its main folder once, then its bare repository, made whole or not at all. */
  private async prepare(project: string, folder: string): Promise<void> {
    await transferRecords(this.deps.db, project, folder, this.deps.log)
    const repository = this.repositoryOf(project)
    if (existsSync(repository)) return
    mkdirSync(this.deps.dir, { recursive: true })
    const draft = `${repository}.new`
    rmSync(draft, { recursive: true, force: true })
    const made = await (this.deps.git ?? runGit)(this.deps.dir, ['init', '--bare', '-q', '-b', MEMORY_BRANCH, draft])
    if (made.code !== 0) {
      rmSync(draft, { recursive: true, force: true })
      throw new Error(`git init: ${made.out}`)
    }
    renameSync(draft, repository)
    this.deps.log(`memory: ${project} has a new repository ${repository}`)
  }

  private tellOnce(key: string, line: string): void {
    if (this.told.has(key)) return
    this.told.add(key)
    this.deps.log(line)
  }
}
