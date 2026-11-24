import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Git } from '../../git/types.js'
import { pathKey } from '../../paths.js'
import { MemorySync, type MemorySyncDeps } from './sync.js'

export interface WorkingCopiesDeps {
  /** Each project's memory folders here by its id; the first is the project's main one. */
  folders(): Record<string, string[]>
  /** The project's memory repository as git reaches it from here: a path on the hub, the link's relay on a machine. */
  remoteOf(project: string): string
  /** Runs before a project's first copy starts; a throw leaves the project without copies until the next apply. */
  prepare?(project: string, folder: string): Promise<void>
  /** Who the commits are by. */
  author: string
  log(line: string): void
  git?: Git
  schedule?: MemorySyncDeps['schedule']
  watch?: MemorySyncDeps['watch']
}

export interface Copy {
  project: string
  folder: string
  sync: MemorySync
}

/**
 * The memory folders of one computer kept as working copies of their projects' repositories (`docs/sessions/memory.md`),
 * a `MemorySync` each: the hub's folders (`MemoryHub`) and a machine's (`MachineMemory`). The copies follow `folders`:
 * `apply` starts the copies of new folders and stops those of folders gone. A folder two projects name — the same real
 * path — is the first one's; the other is told in the log once and gets none.
 */
export class WorkingCopies {
  private readonly copies = new Map<string, Copy>()
  private applying: Promise<void> = Promise.resolve()
  private readonly told = new Set<string>()
  private stopped = false

  constructor(private readonly deps: WorkingCopiesDeps) {}

  /** The folders as `folders` gives them now: new ones synced, gone ones left. One apply runs at a time. */
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

  /** The working copy of the project's main folder; `undefined` — it has none (not applied yet, or git failed for it). */
  primary(project: string): Copy | undefined {
    const first = this.deps.folders()[project]?.[0]
    if (first === undefined) return undefined
    const copy = this.copies.get(this.keyOf(first))
    return copy?.project === project ? copy : undefined
  }

  /** The folders that have a working copy now. */
  folders(): string[] {
    return [...this.copies.values()].map((copy) => copy.folder)
  }

  /** A sync of every working copy now, or of the project's only: the link back, a push from elsewhere, a call that needs the newest files. */
  syncAll(project?: string): Promise<unknown> {
    const copies = [...this.copies.values()].filter((copy) => project === undefined || copy.project === project)
    return Promise.allSettled(copies.map((copy) => copy.sync.sync()))
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
        await this.deps.prepare?.(project, this.deps.folders()[project]?.[0] ?? folders[0]!)
      } catch (error) {
        this.deps.log(`memory: ${project} has no repository: ${(error as Error).message}`)
        continue
      }
      if (this.stopped) return
      for (const key of keys) {
        const folder = wanted.get(key)!.folder
        const sync = new MemorySync({
          folder,
          remote: this.deps.remoteOf(project),
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

  private tellOnce(key: string, line: string): void {
    if (this.told.has(key)) return
    this.told.add(key)
    this.deps.log(line)
  }
}
