import { isBranchName, readBranches } from '../git/branches.js'
import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import type { BranchDrift, RepoBranches } from './branch.js'
import { moveBranch } from './branch-move.js'

export interface BranchControlDeps {
  git: Git
  /** The project's main checkout; `undefined` — the config does not know the project. */
  repo(project: string): string | undefined
  /** The project's `branch` key. */
  branch(project: string): string
  /** The project's key, which the config's refusal of a branch is placed by. */
  key(project: string): string
  /** A task of the project is in hand or one of its sessions is mid-turn: the branch the chain merges into must hold. */
  busy(project: string): boolean
  /** Writes the project's `branch` key alone. */
  write(project: string, branch: string): void
  changed(): void
}

/**
 * The project's main branch and its main checkout as one (BTN-754). A new branch saved on the page moves the checkout;
 * a checkout moved by hand does not move the branch: it is shown as a drift, read when the settings open and when the
 * chain starts, never polled, and the page offers to adopt the checkout's branch or to put the checkout back.
 */
export class BranchControl {
  private readonly drift = new Map<string, BranchDrift>()

  constructor(private readonly deps: BranchControlDeps) {}

  /** The projects whose checkout stands off their branch, as last read. */
  view(): Record<string, BranchDrift> {
    return Object.fromEntries(this.drift)
  }

  /** The checkout's branches for the settings' field; reading them notes the drift. */
  async branches(project: string): Promise<RepoBranches> {
    const read = await readBranches(this.deps.git, this.repoOf(project))
    if (read === null) throw fail('branch.noRepo', { project })
    this.note(project, read.current)
    return read
  }

  /** The chain's start reads the checkout too, so its card warns before a task's launch refuses (`git.wrongBranch`). */
  async refresh(project: string): Promise<void> {
    if (this.deps.repo(project) === undefined) return
    try {
      await this.branches(project)
    } catch (error) {
      console.warn(`git: the branches of ${project} were not read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The settings saved with another branch: the checkout goes there in `repo` first, then `write` saves the form. */
  async change<T>(project: string, repo: string, branch: string, write: () => T): Promise<T> {
    if (!(await isBranchName(this.deps.git, repo, branch))) throw fail('config.branch', { where: `${this.deps.key(project)}.branch`, value: JSON.stringify(branch) })
    // The chain merges a task in hand into the branch it started from: the branch holds until the task ends, moved or not.
    this.requireIdle(project)
    const result = await moveBranch(this.deps.git, repo, null, branch, write, project)
    this.note(project, branch, branch)
    return result
  }

  /** "Make it the main branch": the checkout's branch becomes `branch`, git is not touched. */
  async adopt(project: string): Promise<void> {
    this.requireIdle(project)
    const { current } = await this.branches(project)
    if (current === null) throw fail('branch.noRepo', { project })
    this.deps.write(project, current)
    this.note(project, current, current)
    console.log(`page: the main branch of ${project} is now ${current}, the branch its checkout stands on`)
  }

  /** "Put the folder back": the checkout goes onto `branch`, with the same refusals as a save. */
  async restore(project: string): Promise<void> {
    this.requireIdle(project)
    const branch = this.deps.branch(project)
    await moveBranch(this.deps.git, this.repoOf(project), null, branch, () => undefined, project)
    this.note(project, branch)
  }

  private requireIdle(project: string): void {
    if (this.deps.busy(project)) throw fail('branch.busy', { project })
  }

  private repoOf(project: string): string {
    const repo = this.deps.repo(project)
    if (repo === undefined) throw fail('config.unknownProject', { key: project })
    return repo
  }

  private note(project: string, current: string | null, branch = this.deps.branch(project)): void {
    const before = this.drift.get(project)
    const now = current === branch ? undefined : { branch, current }
    if (JSON.stringify(before) === JSON.stringify(now)) return
    if (now === undefined) this.drift.delete(project)
    else this.drift.set(project, now)
    this.deps.changed()
  }
}
