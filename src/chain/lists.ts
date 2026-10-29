import { notice, noticeOf, type Notice } from '../notice/notice.js'
import { isOpen, type Task } from '../tracker/model.js'
import type { ChainState, DispatcherDeps, ProjectOrder } from './model.js'
import { activeMilestone, milestoneCandidate, type ChainView } from './milestones.js'
import { chainOrder, waitingBlockers, withFresh } from './order.js'
import type { Reviews } from './reviews.js'
import { admits, isActive, isTerminal, type ChainRules } from './rules.js'

/** Each project's tasks as the dispatcher last sorted them, and the order and views the page gets from them. */
export class TaskLists {
  /** The project's open tasks as the tracker last gave them, before the chain's filter. */
  readonly listed = new Map<string, Task[]>()
  readonly tasks = new Map<string, Task[]>()
  readonly waiting = new Map<string, Task[]>()
  readonly outside = new Map<string, Task[]>()
  readonly backlog = new Map<string, Task[]>()
  readonly done = new Map<string, Set<string>>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly reviews: Reviews,
    /** The task the project's chain leads, as `Dispatcher.currentOf` gives it. */
    private readonly currentOf: (project: string) => string | undefined,
  ) {}

  maps(): Map<string, unknown>[] {
    return [this.listed, this.tasks, this.waiting, this.outside, this.backlog, this.done]
  }

  /** The tasks of the list the chain would take, and their open blockers outside it. */
  sorted(project: string, tasks: Task[]): { chain: Task[]; waiting: Task[] } {
    const rules = (task: Task) => this.deps.rules(project, task.id)
    const chain = tasks.filter((task) => admits(rules(task), task) && this.enters(project, task, rules(task)))
    const outside = (this.outside.get(project) ?? []).filter((task) => isOpen(task.status))
    const waiting = waitingBlockers(chain, [...tasks, ...outside].filter((task) => !isTerminal(rules(task), task.status) && !chain.includes(task)))
    return { chain, waiting }
  }

  private enters(project: string, task: Task, rules: ChainRules): boolean {
    const current = this.currentOf(project) === task.id
    if (this.reviews.holds(project, task.id) && !current) return false
    if (isActive(rules, task.status)) return true
    return current && this.deps.busy(task.id)
  }

  orders(): Record<string, ProjectOrder> {
    const result: Record<string, ProjectOrder> = {}
    for (const [project, tasks] of this.tasks) {
      const waiting = this.waitingIds(project)
      const backlog = (this.backlog.get(project) ?? []).map((task) => task.id)
      const listed = this.outside.get(project) ?? []
      const outside = (this.waiting.get(project) ?? []).filter((task) => listed.includes(task))
      const reviews = this.reviews.views(project)
      const extra = { ...(outside.length > 0 && { outside }), ...(reviews.length > 0 && { reviews }) }
      try {
        const order = chainOrder(tasks, this.preferred(project))
        const { landing, landingMilestones, refused } = this.landing(project)
        result[project] = {
          order,
          waiting,
          ...extra,
          backlog,
          ...(Object.keys(landing).length > 0 ? { landing } : {}),
          ...(Object.keys(landingMilestones).length > 0 ? { landingMilestones } : {}),
          ...(Object.keys(refused).length > 0 ? { refused } : {}),
          error: null,
        }
      } catch (error) {
        result[project] = { order: [], waiting, ...extra, backlog, error: noticeOf(error) }
      }
    }
    return result
  }

  view(project: string): ChainView {
    const listed = this.outside.get(project) ?? []
    return {
      tasks: this.tasks.get(project) ?? [],
      blockers: (this.waiting.get(project) ?? []).filter((task) => !listed.includes(task)),
      current: this.currentOf(project),
    }
  }

  whyEmpty(project: string, tasks: Task[]): Notice {
    const skipped = this.state.skipped[project] ?? []
    if (tasks.length > 0) return tasks.every((task) => skipped.includes(task.id)) ? notice('chain.emptySkipped', {}) : notice('chain.emptyBlocked', {})
    const backlog = this.backlog.get(project) ?? []
    const active = backlog.find((task) => isActive(this.deps.rules(project, task.id), task.status))
    if (active !== undefined) return notice('chain.emptyLabels', { labels: this.deps.rules(project, active.id).requiredLabels })
    return backlog.length > 0 ? notice('chain.emptyStatus', {}) : notice('chain.emptyNone', {})
  }

  waitingIds(project: string): string[] {
    return (this.waiting.get(project) ?? []).map((task) => task.id)
  }

  /** Whether the task is open in the tracker, in the chain or out of it. */
  readonly listedOpen = (project: string, task: string): boolean =>
    [...(this.tasks.get(project) ?? []), ...(this.waiting.get(project) ?? []), ...(this.backlog.get(project) ?? [])].some((each) => each.id === task)

  private preferred(project: string, stored = this.state.orders[project]): string[] | undefined {
    const current = this.currentOf(project)
    if (current === undefined) return stored
    return [current, ...(stored ?? []).filter((id) => id !== current)]
  }

  placeNew(project: string): boolean {
    const placed = this.placed(project, this.tasks.get(project) ?? [])
    if (placed === undefined) return false
    this.state.orders[project] = placed
    return true
  }

  /** The manual order with the chain's new tasks put in and the gone ones dropped; `undefined` — there is none or nothing changes. */
  private placed(project: string, tasks: Task[]): string[] | undefined {
    const stored = this.state.orders[project]
    if (stored === undefined) return undefined
    const open = new Set(tasks.map((task) => task.id))
    const kept = stored.filter((id) => open.has(id))
    const fresh = [...open].filter((id) => !stored.includes(id))
    if (fresh.length === 0 && kept.length === stored.length) return undefined

    const preferred = this.preferred(project, kept)!.filter((id) => open.has(id))
    const current = this.currentOf(project)
    const base = withFresh(tasks, preferred, fresh, current !== undefined && preferred[0] === current ? 1 : 0)
    try {
      return chainOrder(tasks, base)
    } catch {
      return base
    }
  }

  /** Called only once the chain's own order builds, so a refusal is the task's doing. */
  private landing(project: string): Pick<Required<ProjectOrder>, 'landing' | 'landingMilestones' | 'refused'> {
    const chain = this.tasks.get(project) ?? []
    const outside = this.outside.get(project) ?? []
    const blockers = (this.waiting.get(project) ?? []).filter((task) => !outside.some((each) => each.id === task.id))
    const landing: Record<string, string | null> = {}
    const landingMilestones: NonNullable<ProjectOrder['landingMilestones']> = {}
    const refused: Record<string, Notice> = {}
    const donor = this.deps.fillsMilestone?.(project) ? activeMilestone(chain, this.currentOf(project)) : undefined
    for (const task of [...(this.backlog.get(project) ?? []), ...blockers]) {
      if (!admits(this.deps.rules(project, task.id), task)) continue
      const planned = [...chain, task, ...blockers.filter((each) => each.id !== task.id)]
      const candidate = milestoneCandidate(task, donor, planned)
      const tasks = [...chain, candidate]
      try {
        const order = chainOrder(tasks, this.preferred(project, this.placed(project, tasks) ?? this.state.orders[project]))
        landing[task.id] = order[order.indexOf(task.id) + 1] ?? null
        if (candidate !== task) landingMilestones[task.id] = candidate.milestone!
      } catch (error) {
        refused[task.id] = noticeOf(error)
      }
    }
    return { landing, landingMilestones, refused }
  }
}
