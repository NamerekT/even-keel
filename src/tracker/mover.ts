import { moveLevel, movesOf, moveVerdict, type MoveWhen, type StatusMoves } from '../chain/moves.js'
import { sameName, type ChainRules } from '../chain/rules.js'
import { notice, type Notice } from '../notice/notice.js'
import { errorText } from './link.js'
import type { TaskStatus } from './model.js'

/** What a task's source moves it by: its reader, the reader's rules and the status moves of its profile and its own. */
export interface MovePlan {
  reader: string
  rules: ChainRules
  profile?: StatusMoves
  source?: StatusMoves
}

export interface StatusMoverDeps {
  /** `undefined` — the task's tracker is off or moves no statuses. */
  plan: (project: string, task: string) => MovePlan | undefined
  /** The task's status now; `undefined` — the tracker does not know the task. */
  current: (reader: string, task: string) => Promise<TaskStatus | undefined>
  /** The statuses the reader's tracker lists, to judge the target by its category; none — judged by the tracker. */
  statuses: (reader: string) => Promise<readonly TaskStatus[]>
  moveTo: (reader: string, task: string, status: string) => Promise<TaskStatus | null>
  log: (line: string) => void
  /** A failure came or went: the page shows them. */
  changed?: () => void
}

/**
 * Moves a task to the status its source chose when Even Keel starts it or opens its pull request (BTN-554), only
 * forward (`moveVerdict`). A refusal never stops the chain: it is logged and kept in memory for the page, by reader, until
 * a later move of the task goes through; the page shows only those of open tasks.
 */
export class StatusMover {
  private readonly failed = new Map<string, Map<string, Notice>>()

  constructor(private readonly deps: StatusMoverDeps) {}

  failures(reader: string): Notice[] {
    return [...(this.failed.get(reader)?.values() ?? [])]
  }

  async move(project: string, task: string, when: MoveWhen): Promise<void> {
    const plan = this.deps.plan(project, task)
    if (plan === undefined) return
    const name = movesOf(plan.profile, plan.source)[when]
    const level = moveLevel(plan.profile, plan.source, when)
    if (name === null || level === null) return
    const params = { task, status: name, setting: when, level }
    try {
      const current = await this.deps.current(plan.reader, task)
      if (current === undefined) return
      const statuses = await this.deps.statuses(plan.reader).catch(() => [])
      const verdict = moveVerdict(when, plan.rules, current, statuses.find((each) => sameName(each.name, name)) ?? null)
      if (verdict === 'outside') {
        this.deps.log(`tracker: ${task} stays in "${current.name}": "${name}" is out of the chain by its rules`)
        this.note(plan.reader, task, notice('statusMove.outside', params))
        return
      }
      if (verdict === 'stay') return
      const moved = await this.deps.moveTo(plan.reader, task, name)
      if (moved === null) {
        const detail = `no status "${name}" to move to from "${current.name}"`
        this.deps.log(`tracker: ${task} was not moved: ${detail}`)
        this.note(plan.reader, task, notice('statusMove.refused', params, { detail }))
        return
      }
      this.deps.log(`tracker: moved ${task} to "${moved.name}" on its ${when === 'start' ? 'start' : 'pull request'}`)
      this.note(plan.reader, task, null)
    } catch (error) {
      this.deps.log(`tracker: ${task} was not moved to "${name}": ${errorText(error)}`)
      this.note(plan.reader, task, notice('statusMove.refused', params, { detail: errorText(error) }))
    }
  }

  private note(reader: string, task: string, failure: Notice | null): void {
    const failures = this.failed.get(reader) ?? new Map<string, Notice>()
    if (failure === null && !failures.has(task)) return
    if (failure === null) failures.delete(task)
    else failures.set(task, failure)
    this.failed.set(reader, failures)
    this.deps.changed?.()
  }
}
