import { remoteHas, remoteOf } from '../git/push.js'
import { runGit } from '../git/run.js'
import type { Git } from '../git/types.js'
import { taskPlace } from '../git/worktree.js'
import type { Assignments } from '../machine/assignments.js'
import { reassignable } from '../machine/reassign.js'
import type { TaskMoves } from '../machine/task-moves.js'
import { NoticeError, type Notice } from '../notice/notice.js'
import type { StrandedTask } from '../state.js'

/** How long a remote's answer about a stranded task's branch stands before the page asks again. */
export const PUSHED_FRESH_MS = 60_000

export interface ReassignDeps {
  own: () => string
  assignments: Assignments
  moves: TaskMoves
  /** The machine elsewhere is connected and not revoked. */
  connected: (machine: string) => boolean
  /** The hub's name of each machine. */
  names: () => Record<string, string>
  /** The project's folder on the hub; `undefined` — no such project. */
  repoOf: (project: string) => string | undefined
  /** The chain ends the task's lane on the machine it left. */
  moved: (project: string, task: string) => void
  /** The remote answered about a stranded task's branch: the page shows it. */
  changed: () => void
  log: (line: string) => void
  git?: Git
  now?: () => number
}

type Pushed = boolean | { error: string }

/**
 * The tasks a machine gone holds and their move to another machine by hand (BTN-1270, `docs/machines.md`, "A machine
 * gone"): the task's `machine_tasks` row goes, a `task_moves` row keeps the machine it left, and the chain takes it into a
 * lane elsewhere, where its first launch restores the branch from the remote.
 */
export class Reassigner {
  private readonly answers = new Map<string, { pushed: Pushed; at: number }>()
  private readonly asking = new Set<string>()
  private readonly git: Git
  private readonly now: () => number

  constructor(private readonly deps: ReassignDeps) {
    this.git = deps.git ?? runGit
    this.now = deps.now ?? Date.now
  }

  /**
   * By project, the tasks held by a machine elsewhere that is away or revoked, with what the remote last said of their
   * branch; an answer older than `PUSHED_FRESH_MS` is asked again behind.
   */
  stranded(): Record<string, Record<string, StrandedTask>> {
    const own = this.deps.own()
    const result: Record<string, Record<string, StrandedTask>> = {}
    for (const { project, task, machine } of this.deps.assignments.all()) {
      if (machine === own || this.deps.connected(machine)) continue
      const key = `${project}\n${task}`
      const answer = this.answers.get(key)
      if (answer === undefined || this.now() - answer.at > PUSHED_FRESH_MS) this.ask(project, task)
      const pushed = answer === undefined ? null : answer.pushed === true
      ;(result[project] ??= {})[task] = { machine, pushed }
    }
    return result
  }

  /** Moves the task off its machine gone; a `NoticeError` says why it cannot move. */
  async reassign(project: string, task: string): Promise<void> {
    const repo = this.deps.repoOf(project)
    const holder = this.deps.assignments.machineOf(project, task)
    const { branch } = taskPlace(repo ?? '', task)
    const remote = repo === undefined ? null : await remoteOf(this.git, repo)
    const pushed = remote === null ? false : await remoteHas(this.git, repo!, remote, branch)
    this.answers.set(`${project}\n${task}`, { pushed, at: this.now() })
    const holderName = holder === undefined ? '' : (this.deps.names()[holder] ?? holder)
    const refusal: Notice | null = reassignable({
      task, holder, own: this.deps.own(), connected: holder !== undefined && this.deps.connected(holder), holderName, branch, remote, pushed,
    })
    if (refusal !== null) throw new NoticeError(refusal)
    this.deps.assignments.release(project, task)
    this.deps.moves.add(project, task, holder!, branch)
    this.deps.log(`machine: ${task} is moved off machine ${holderName} by hand; its next session starts from ${remote}/${branch}`)
    this.deps.moved(project, task)
  }

  private ask(project: string, task: string): void {
    const key = `${project}\n${task}`
    const repo = this.deps.repoOf(project)
    if (repo === undefined || this.asking.has(key)) return
    this.asking.add(key)
    void (async () => {
      const remote = await remoteOf(this.git, repo)
      const pushed = remote === null ? false : await remoteHas(this.git, repo, remote, taskPlace(repo, task).branch)
      const was = this.answers.get(key)?.pushed
      this.answers.set(key, { pushed, at: this.now() })
      if (JSON.stringify(was) !== JSON.stringify(pushed)) this.deps.changed()
    })()
      .catch((error: unknown) => this.deps.log(`machine: could not ask the remote about the branch of ${task}: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => this.asking.delete(key))
  }
}
