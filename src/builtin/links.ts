import { compareMilestones } from '../chain/order.js'
import type { TaskMilestone } from '../tracker/model.js'

export interface BlockEdge {
  from: string
  to: string
}

/** Whether `from` blocking `to` closes a loop: `to` already blocks `from`, directly or through other tasks. */
export function closesLoop(blocks: readonly BlockEdge[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const queue = [to]
  while (queue.length > 0) {
    const task = queue.shift()!
    if (task === from) return true
    if (seen.has(task)) continue
    seen.add(task)
    for (const edge of blocks) if (edge.from === task) queue.push(edge.to)
  }
  return false
}

/**
 * A blocker in a later milestone than the task it holds: the chain cannot order that (`order.later`). A task without a
 * milestone fits anywhere, so either side without one is no refusal.
 */
export function laterBlocker(blocker: TaskMilestone | null, held: TaskMilestone | null): boolean {
  return blocker !== null && held !== null && compareMilestones(blocker, held) > 0
}
