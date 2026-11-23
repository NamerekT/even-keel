import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import { shiftBack, shiftBranch } from '../projects/branch-move.js'
import type { BranchShift } from '../projects/branch.js'
import { sameJson } from './facts.js'
import type { MachineBranch } from './services.js'

export interface BranchHereDeps {
  git: Git
  /** The project's folder on the machine; `null` — a project without git; `undefined` — not the machine's project. */
  folderOf(project: string): string | null | undefined
  /** git with the project's credentials, for the fetch before a move: a branch only on the remote is taken from there. */
  fetchGit?: (project: string) => Git
  /** The folder of the project may stand elsewhere now: read it again. */
  moved(project: string): void
}

const STAYED: BranchShift = { before: { current: null, head: null, branches: [] }, move: { kind: 'stay' } }

/** The machine's side of the hub's branch change (BTN-1567): its folder of the project moves as the hub's checkout does. */
export function branchHere(deps: BranchHereDeps): MachineBranch {
  const folder = (project: string): string | null => {
    const found = deps.folderOf(project)
    if (found === undefined) throw fail('config.unknownProject', { key: project })
    return found
  }
  return {
    move: async (project, branch) => {
      const repo = folder(project)
      if (repo === null) return STAYED
      const fetched = await (deps.fetchGit?.(project) ?? deps.git)(repo, ['fetch', '--all', '--quiet'])
      // A folder that cannot reach its remote still moves by its own branches, as the hub's does.
      if (fetched.code !== 0) console.warn(`git: ${repo} was not fetched before its move to ${branch}: ${fetched.out.trim()}`)
      try {
        return await shiftBranch(deps.git, repo, null, branch, project)
      } finally {
        deps.moved(project)
      }
    },
    back: async (project, branch, shift) => {
      const repo = folder(project)
      if (repo === null) return
      await shiftBack(deps.git, repo, branch, shift)
      deps.moved(project)
    },
  }
}

export interface CheckoutWatchDeps {
  git: Git
  /** The machine's projects with git, each with its folder. */
  projects(): Record<string, string>
  changed(): void
  log?: (line: string) => void
}

/** How often a machine elsewhere reads the branch of its projects' folders: a folder switched by hand is seen in this. */
export const CHECKOUT_READ_MS = 30_000

/**
 * The branch each project's folder on the machine stands on (BTN-1567), for its facts (`checkouts`): the hub compares it
 * with the project's `branch`, so a folder moved by hand is a drift on its page and holds the machine's launches.
 */
export class CheckoutWatch {
  private current: Record<string, { branch: string | null }> = {}
  private reading: Promise<void> | undefined
  private again = false
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly deps: CheckoutWatchDeps) {}

  /** Reads the folders now and every `everyMs`. */
  start(everyMs = CHECKOUT_READ_MS): void {
    void this.check()
    this.timer ??= setInterval(() => void this.check(), everyMs)
    this.timer.unref?.()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  view(): Record<string, { branch: string | null }> {
    return this.current
  }

  /** Reads every folder; a read under way is followed by one more, so a change made meanwhile is seen. */
  check(): Promise<void> {
    if (this.reading !== undefined) {
      this.again = true
      return this.reading
    }
    const read = this.readAll().catch((error: unknown) => this.deps.log?.(`git: the branches of the projects' folders were not read: ${error instanceof Error ? error.message : String(error)}`))
    this.reading = read.finally(() => {
      this.reading = undefined
      if (this.again) {
        this.again = false
        void this.check()
      }
    })
    return this.reading
  }

  private async readAll(): Promise<void> {
    const next: Record<string, { branch: string | null }> = {}
    for (const [project, repo] of Object.entries(this.deps.projects())) {
      const head = await this.deps.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      // 1 is a detached HEAD; anything else — no repository there (yet), or no git: nothing to tell of it.
      if (head.code === 0 && head.out.trim() !== '') next[project] = { branch: head.out.trim() }
      else if (head.code === 1 && head.missing !== true) next[project] = { branch: null }
    }
    if (sameJson(next, this.current)) return
    this.current = next
    this.deps.changed()
  }
}
