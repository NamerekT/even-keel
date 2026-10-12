import type { Task } from '../tracker/model.js'
import { byNumber, chainOrder, compareMilestones } from './order.js'

export interface ChainView {
  /** The tasks in the chain. */
  tasks: Task[]
  /** Their open blockers that are not in the chain yet but may enter it. */
  blockers: Task[]
  current: string | undefined
}

export interface MilestoneFill {
  task: string
  /** The task whose milestone it got. */
  like: string
  milestone: string
}

export interface MilestoneFillerOptions {
  /** The project's `fillMilestone` setting. */
  enabled: (project: string) => boolean
  /** Puts the task into the milestone of `like`; `false` — the tracker left the task alone. */
  assign: (task: string, like: string) => Promise<boolean>
  onError?: (error: unknown) => void
}

/** The task that carries the active milestone: the current one, else the one with the earliest milestone in the chain. */
export function activeMilestone(tasks: Task[], current: string | undefined): Task | undefined {
  const planned = tasks.filter((task) => task.milestone !== null)
  return (
    planned.find((task) => task.id === current) ??
    [...planned].sort((a, b) => compareMilestones(a.milestone!, b.milestone!) || byNumber(a.id, b.id))[0]
  )
}

function builds(tasks: Task[]): boolean {
  try {
    chainOrder(tasks)
    return true
  } catch {
    return false
  }
}

/**
 * Gives the active milestone to a task that entered the chain without one, once per stay in the chain: what a person
 * does to the milestone afterwards is theirs. A task whose blockers would then go against the milestone order is left alone.
 */
export class MilestoneFiller {
  private readonly settled = new Map<string, Set<string>>()

  constructor(private readonly options: MilestoneFillerOptions) {}

  async sweep(project: string, view: ChainView): Promise<MilestoneFill[]> {
    if (!this.options.enabled(project)) {
      this.settled.delete(project)
      return []
    }
    const inChain = new Set(view.tasks.map((task) => task.id))
    const settled = new Set([...(this.settled.get(project) ?? [])].filter((id) => inChain.has(id)))
    this.settled.set(project, settled)
    const entered = view.tasks.filter((task) => !settled.has(task.id))
    for (const task of entered) if (task.milestone !== null) settled.add(task.id)

    const bare = entered.filter((task) => task.milestone === null).sort((a, b) => byNumber(a.id, b.id))
    const donor = activeMilestone(view.tasks, view.current)
    let planned = [...view.tasks, ...view.blockers]
    if (bare.length === 0 || donor === undefined || !builds(planned)) return []

    const filled: MilestoneFill[] = []
    for (const task of bare) {
      const next = planned.map((each) => (each.id === task.id ? { ...each, milestone: donor.milestone } : each))
      try {
        if (builds(next) && (await this.options.assign(task.id, donor.id))) {
          planned = next
          filled.push({ task: task.id, like: donor.id, milestone: donor.milestone!.label })
        }
        settled.add(task.id)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    return filled
  }
}
