import { isBranchName, readBranches } from '../git/branches.js'
import type { Git } from '../git/types.js'
import { fail, noticeOf } from '../notice/notice.js'
import type { BranchDrift, BranchShift, RepoBranches } from './branch.js'
import { moveBranch } from './branch-move.js'

/** A machine elsewhere of the project's pool, turned on. */
export interface PoolCheckout {
  id: string
  name: string
  online: boolean
}

/** The project's folders on the machines elsewhere (BTN-1567): moved over the link with the hub's checkout. */
export interface BranchMachines {
  /** The machines elsewhere of the project's pool turned on: each one's folder moves with the checkout. */
  pool(project: string): PoolCheckout[]
  move(machine: string, project: string, branch: string): Promise<BranchShift>
  back(machine: string, project: string, branch: string, shift: BranchShift): Promise<void>
  /** By project and machine elsewhere of its pool, the branch its folder stands on as its facts last said; `null` — detached. */
  checkouts(): Record<string, Record<string, string | null>>
}

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
  /** The machines elsewhere; absent — the hub has none (tests). */
  machines?: BranchMachines
}

/**
 * The project's main branch and its main checkout as one (BTN-754). A new branch saved on the page moves the checkout;
 * a checkout moved by hand does not move the branch: it is shown as a drift, read when the settings open and when the
 * chain starts, never polled, and the page offers to adopt the checkout's branch or to put the checkout back. The
 * folders of the project on the machines elsewhere of its pool move with it, and one off the branch is a drift of that
 * machine, from its facts (BTN-1567).
 */
export class BranchControl {
  private readonly drift = new Map<string, BranchDrift>()

  constructor(private readonly deps: BranchControlDeps) {}

  /** The projects whose checkout stands off their branch, as last read. */
  view(): Record<string, BranchDrift> {
    return Object.fromEntries(this.drift)
  }

  /** By project and machine elsewhere, the folders that stand off the project's branch, as the machines last told. */
  machineDrift(): Record<string, Record<string, BranchDrift>> {
    const drift: Record<string, Record<string, BranchDrift>> = {}
    for (const [project, machines] of Object.entries(this.deps.machines?.checkouts() ?? {})) {
      if (this.deps.repo(project) === undefined) continue
      const branch = this.deps.branch(project)
      for (const [machine, current] of Object.entries(machines)) if (current !== branch) (drift[project] ??= {})[machine] = { branch, current }
    }
    return drift
  }

  /** The machine's folder of the project stands off its branch: the machine takes no task of the project until it is back. */
  held(project: string, machine: string): boolean {
    if (this.deps.repo(project) === undefined) return false
    const current = this.deps.machines?.checkouts()[project]?.[machine]
    return current !== undefined && current !== this.deps.branch(project)
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

  /**
   * The settings saved with another branch: the folders of the pool's machines elsewhere go there one by one, then the
   * checkout in `repo`, then `write` saves the form; any refusal puts back the folders already moved.
   */
  async change<T>(project: string, repo: string, branch: string, write: () => T): Promise<T> {
    if (!(await isBranchName(this.deps.git, repo, branch))) throw fail('config.branch', { where: `${this.deps.key(project)}.branch`, value: JSON.stringify(branch) })
    // The chain merges a task in hand into the branch it started from: the branch holds until the task ends, moved or not.
    this.requireIdle(project)
    const moved = await this.moveMachines(project, branch)
    let result: T
    try {
      result = await moveBranch(this.deps.git, repo, null, branch, write, project)
    } catch (error) {
      await this.putBack(project, branch, moved)
      throw error
    }
    this.note(project, branch, branch)
    return result
  }

  /**
   * "Make it the main branch": the checkout's branch becomes `branch`, git is not touched. Of a machine elsewhere's
   * folder, its branch is saved as any new one: the checkout and the other machines' folders go there too.
   */
  async adopt(project: string, machine?: string): Promise<void> {
    this.requireIdle(project)
    if (machine !== undefined) {
      const current = this.deps.machines?.checkouts()[project]?.[machine]
      if (current === undefined || current === null) throw fail('branch.noRepo', { project })
      await this.change(project, this.repoOf(project), current, () => this.deps.write(project, current))
      console.log(`page: the main branch of ${project} is now ${current}, the branch its folder on machine ${machine} stands on`)
      return
    }
    const { current } = await this.branches(project)
    if (current === null) throw fail('branch.noRepo', { project })
    this.deps.write(project, current)
    this.note(project, current, current)
    console.log(`page: the main branch of ${project} is now ${current}, the branch its checkout stands on`)
  }

  /** "Put the folder back": the checkout, or the machine's folder, goes onto `branch`, with the same refusals as a save. */
  async restore(project: string, machine?: string): Promise<void> {
    this.requireIdle(project)
    const branch = this.deps.branch(project)
    if (machine !== undefined) {
      const found = this.deps.machines?.pool(project).find((each) => each.id === machine)
      if (found !== undefined && !found.online) throw fail('branch.machineOffline', { project, name: found.name })
      await this.deps.machines?.move(machine, project, branch)
      this.deps.changed()
      return
    }
    await moveBranch(this.deps.git, this.repoOf(project), null, branch, () => undefined, project)
    this.note(project, branch)
  }

  private async moveMachines(project: string, branch: string): Promise<Array<{ machine: string; shift: BranchShift }>> {
    const machines = this.deps.machines
    if (machines === undefined) return []
    const pool = machines.pool(project)
    const away = pool.find((machine) => !machine.online)
    if (away !== undefined) throw fail('branch.machineOffline', { project, name: away.name })
    const moved: Array<{ machine: string; shift: BranchShift }> = []
    for (const { id, name } of pool) {
      try {
        moved.push({ machine: id, shift: await machines.move(id, project, branch) })
      } catch (error) {
        console.warn(`git: the folder of ${project} on machine ${id} (${name}) did not go to ${branch}: ${error instanceof Error ? error.message : String(error)}`)
        await this.putBack(project, branch, moved)
        throw fail('branch.machineFailed', { project, name }, { cause: noticeOf(error) })
      }
    }
    return moved
  }

  private async putBack(project: string, branch: string, moved: Array<{ machine: string; shift: BranchShift }>): Promise<void> {
    for (const { machine, shift } of moved.reverse()) {
      try {
        await this.deps.machines!.back(machine, project, branch, shift)
      } catch (error) {
        console.warn(`git: the folder of ${project} on machine ${machine} was not put back after a refused move to ${branch}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
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
