import { englishOf, noticeOf } from '../notice/notice.js'
import { samePath, spelledUnder } from '../paths.js'
import type { BranchDiff, TaskWork } from '../state.js'
import { changesOf } from './changes.js'
import { branchDiffOf } from './diff.js'
import type { Git } from './types.js'
import { must, parseWorktrees } from './worktree.js'

/** What a project's task folders hold, by task: the work left there and the lines its branch changed. */
export interface TaskFolders {
  /** Only the tasks with work beyond the main branch. */
  works: Record<string, TaskWork>
  /** Every task folder git could read, a clean one with zeros. */
  diffs: Record<string, BranchDiff>
}

/**
 * The work of each task that has a worktree or a slot of its own, whatever its status (BTN-298): a folder is the task's
 * by its branch, `<task>/…`, as Even Keel and a session started by hand name it. The main checkout is nobody's task, and
 * a folder git cannot read is left out rather than failing the rest.
 */
export async function worksOf(git: Git, repo: string, main: string, tasks: string[]): Promise<TaskFolders> {
  const trees = parseWorktrees((await must(git, repo, ['worktree', 'list', '--porcelain'], 'listWorktrees')).out)
  const folders: TaskFolders = { works: {}, diffs: {} }
  for (const tree of trees) {
    if (tree.branch === null || samePath(tree.path, repo)) continue
    const task = tasks.find((id) => tree.branch!.toLowerCase().startsWith(`${id.toLowerCase()}/`))
    if (task === undefined) continue
    const changes = await changesOf(git, tree.path, main).catch(() => null)
    if (changes === null) continue
    if (changes.files === 0 && changes.ahead === 0) {
      folders.diffs[task] = { added: 0, removed: 0 }
      continue
    }
    folders.works[task] = { path: spelledUnder(tree.path, repo), branch: tree.branch, ...changes }
    const diff = await branchDiffOf(git, tree.path, main).catch(() => null)
    if (diff !== null) folders.diffs[task] = diff
  }
  return folders
}

export interface TaskWorksDeps {
  read: (project: string) => Promise<TaskFolders>
  /** How long a project's answer is kept: the chain and the backlog refresh far more often than work changes. */
  ttlMs: number
  now: () => number
  /** When a session of the task last did anything, in ms; `null` — it has none. */
  activity: (task: string) => number | null
  /** A session of the task is mid-turn: its folder still changes, so a read of it waits. */
  busy: (task: string) => boolean
  onChange: () => void
  log: (line: string) => void
}

/**
 * The work of each project's tasks, read at most once per `ttlMs`; a failed read keeps what was seen before. A task's
 * work read before its session last did anything is not shown: the session may have committed or merged it since, and
 * the page would tell of work that is gone. Such a project is read again as soon as that session is quiet. The lines of
 * a branch (`diffs`) are shown as last read, stale or not: a count a turn behind beats one that blinks out every turn.
 */
export class TaskWorks {
  private readonly found = new Map<string, Record<string, TaskWork>>()
  private readonly lines = new Map<string, Record<string, BranchDiff>>()
  /** When the read behind `found` started. */
  private readonly foundAt = new Map<string, number>()
  private readonly readAt = new Map<string, number>()
  private readonly failures = new Map<string, string>()
  private readonly reading = new Map<string, Promise<void>>()

  constructor(private readonly deps: TaskWorksDeps) {}

  async poll(project: string): Promise<void> {
    if (this.reading.has(project)) return
    const at = this.readAt.get(project)
    const outdated = this.stale(project).some((task) => !this.deps.busy(task))
    if (!outdated && at !== undefined && this.deps.now() - at < this.deps.ttlMs) return
    await this.read(project)
  }

  /** Reads the project now, after a read under way: a cleanup has just changed its folders (BTN-332). */
  async refresh(project: string): Promise<void> {
    await this.reading.get(project)
    await this.read(project)
  }

  private read(project: string): Promise<void> {
    const reading: Promise<void> = this.readNow(project).finally(() => {
      if (this.reading.get(project) === reading) this.reading.delete(project)
    })
    this.reading.set(project, reading)
    return reading
  }

  private async readNow(project: string): Promise<void> {
    const start = this.deps.now()
    this.readAt.set(project, start)
    try {
      const { works, diffs } = await this.deps.read(project)
      this.failures.delete(project)
      // What was kept out as stale was never shown: its fresh read is a change even when git says the same.
      const before = JSON.stringify([this.shown(project), this.lines.get(project) ?? {}])
      this.foundAt.set(project, start)
      if (Object.keys(works).length === 0) this.found.delete(project)
      else this.found.set(project, works)
      if (Object.keys(diffs).length === 0) this.lines.delete(project)
      else this.lines.set(project, diffs)
      if (JSON.stringify([this.shown(project), diffs]) !== before) this.deps.onChange()
    } catch (error) {
      const message = englishOf(noticeOf(error))
      if (this.failures.get(project) !== message) this.deps.log(`work: ${project}: the task worktrees were not read: ${message}`)
      this.failures.set(project, message)
    }
  }

  /** Forgets the projects not among `projects`, removed from the config. */
  keep(projects: string[]): void {
    let changed = false
    for (const project of [...this.found.keys()]) {
      if (projects.includes(project)) continue
      this.found.delete(project)
      changed = true
    }
    for (const project of [...this.lines.keys()]) {
      if (projects.includes(project)) continue
      this.lines.delete(project)
      changed = true
    }
    for (const project of [...this.readAt.keys()]) if (!projects.includes(project)) this.readAt.delete(project)
    for (const project of [...this.foundAt.keys()]) if (!projects.includes(project)) this.foundAt.delete(project)
    if (changed) this.deps.onChange()
  }

  view(): Record<string, Record<string, TaskWork>> {
    return Object.fromEntries([...this.found.keys()].map((project) => [project, this.shown(project)] as const).filter(([, shown]) => Object.keys(shown).length > 0))
  }

  /** By project and task, the lines each task's branch changed, as last read. */
  diffs(): Record<string, Record<string, BranchDiff>> {
    return Object.fromEntries(this.lines)
  }

  /** The tasks of the project whose work was read before their session last did anything. */
  private stale(project: string): string[] {
    const at = this.foundAt.get(project)
    if (at === undefined) return []
    return Object.keys(this.found.get(project) ?? {}).filter((task) => (this.deps.activity(task) ?? -Infinity) >= at)
  }

  private shown(project: string): Record<string, TaskWork> {
    const stale = new Set(this.stale(project))
    return Object.fromEntries(Object.entries(this.found.get(project) ?? {}).filter(([task]) => !stale.has(task)))
  }
}
