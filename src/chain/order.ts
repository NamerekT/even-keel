import type { HulyTask, TaskMilestone } from '../huly/model.js'

export const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

type Graph = Map<string, Set<string>>

export function chainOrder(tasks: HulyTask[], preferred: string[] = []): string[] {
  const plan = planOf(tasks)
  const rank = new Map(preferred.map((id, index) => [id, index]))
  const compare = (a: string, b: string) =>
    (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
    (plan.ranks.get(a) ?? Infinity) - (plan.ranks.get(b) ?? Infinity) ||
    byNumber(a, b)

  const pending: Graph = new Map([...plan.blockers].map(([id, deps]) => [id, new Set([...deps, ...plan.earlier.get(id)!])]))
  const order: string[] = []
  while (pending.size > 0) {
    const ready = [...pending].filter(([, deps]) => deps.size === 0).map(([id]) => id)
    if (ready.length === 0) throw deadlock(pending, plan, tasks)
    const next = ready.sort(compare)[0]!
    order.push(next)
    pending.delete(next)
    for (const deps of pending.values()) deps.delete(next)
  }
  return order
}

export function checkOrder(tasks: HulyTask[], order: string[]): void {
  const plan = planOf(tasks)
  const milestones = milestonesById(tasks)
  const position = new Map<string, number>()
  for (const [index, id] of order.entries()) {
    if (!plan.blockers.has(id)) throw new Error(`chain: ${id} is not an open task of this chain`)
    if (position.has(id)) throw new Error(`chain: ${id} appears twice`)
    position.set(id, index)
  }
  const later = (other: string, index: number) => (position.get(other) ?? -1) > index
  for (const [id, index] of position) {
    const blocker = plan.blockers.get(id)!.find((other) => later(other, index))
    if (blocker !== undefined) throw new Error(`chain: ${id} cannot go before ${blocker}, which blocks it`)
    const earlier = plan.earlier.get(id)!.find((other) => later(other, index))
    if (earlier !== undefined) {
      throw new Error(
        `chain: ${id} in ${milestones.get(id)} cannot go before ${earlier} in the earlier ${milestones.get(earlier)}`,
      )
    }
  }
}

export function nextTask(tasks: HulyTask[], order: string[], skipped: string[]): string | undefined {
  const blockers = new Map(tasks.map((task) => [task.id, task.blockedBy]))
  const held = new Set(skipped)
  for (const id of order) {
    if (!held.has(id) && !(blockers.get(id) ?? []).some((other) => held.has(other))) return id
    held.add(id)
  }
  return undefined
}

export function openBlockers(tasks: HulyTask[], id: string): string[] {
  const ids = new Set(tasks.map((task) => task.id))
  return tasks.find((task) => task.id === id)?.blockedBy.filter((other) => ids.has(other)) ?? []
}

export function precedence(tasks: HulyTask[]): Map<string, string[]> {
  const plan = planOf(tasks)
  return new Map([...plan.blockers].map(([id, deps]) => [id, [...deps, ...plan.earlier.get(id)!]]))
}

export function compareMilestones(a: TaskMilestone, b: TaskMilestone): number {
  const left = versionOf(a.label)
  const right = versionOf(b.label)
  const byVersion = left === null || right === null ? Number(left === null) - Number(right === null) : compareVersions(left, right)
  return byVersion || a.targetDate - b.targetDate || byNumber(a.label, b.label)
}

interface Plan {
  blockers: Map<string, string[]>
  earlier: Map<string, string[]>
  ranks: Map<string, number>
}

function planOf(tasks: HulyTask[]): Plan {
  const ids = new Set(tasks.map((task) => task.id))
  const blockers = new Map(tasks.map((task) => [task.id, task.blockedBy.filter((id) => ids.has(id))]))
  const ranks = milestoneRanks(tasks)
  const earlier = new Map(
    tasks.map((task) => {
      const own = ranks.get(task.id)
      return [task.id, own === undefined ? [] : tasks.filter((other) => (ranks.get(other.id) ?? Infinity) < own).map((other) => other.id)]
    }),
  )
  return { blockers, earlier, ranks }
}

function milestoneRanks(tasks: HulyTask[]): Map<string, number> {
  const planned = tasks
    .flatMap((task) => (task.milestone === null ? [] : [{ id: task.id, milestone: task.milestone }]))
    .sort((a, b) => compareMilestones(a.milestone, b.milestone))
  const ranks = new Map<string, number>()
  let rank = 0
  for (const [index, { id, milestone }] of planned.entries()) {
    if (index > 0 && compareMilestones(planned[index - 1]!.milestone, milestone) !== 0) rank++
    ranks.set(id, rank)
  }
  return ranks
}

function milestonesById(tasks: HulyTask[]): Map<string, string> {
  return new Map(tasks.flatMap((task) => (task.milestone === null ? [] : [[task.id, task.milestone.label] as const])))
}

function versionOf(label: string): number[] | null {
  const match = /\d+(?:\.\d+)*/.exec(label)
  return match === null ? null : match[0].split('.').map(Number)
}

function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? -1) - (b[index] ?? -1)
    if (difference !== 0) return difference
  }
  return 0
}

function deadlock(pending: Graph, plan: Plan, tasks: HulyTask[]): Error {
  const blockerKnot = knot(new Map([...pending.keys()].map((id) => [id, new Set(plan.blockers.get(id)!.filter((other) => pending.has(other)))])))
  if (blockerKnot.size > 0) return new Error(`chain: cycle: ${findCycle(blockerKnot).join(' → ')}`)

  const milestones = milestonesById(tasks)
  for (const id of [...pending.keys()].sort(byNumber)) {
    const own = plan.ranks.get(id)
    if (own === undefined) continue
    const blocker = plan.blockers.get(id)!.find((other) => (plan.ranks.get(other) ?? -1) > own)
    if (blocker !== undefined) {
      return new Error(`chain: ${id} in ${milestones.get(id)} is blocked by ${blocker} in the later ${milestones.get(blocker)}`)
    }
  }
  return new Error(`chain: blockers go against the milestone order: ${findCycle(pending).join(' → ')}`)
}

function knot(graph: Graph): Graph {
  const rest: Graph = new Map([...graph].map(([id, deps]) => [id, new Set(deps)]))
  for (;;) {
    const free = [...rest].filter(([, deps]) => deps.size === 0).map(([id]) => id)
    if (free.length === 0) return rest
    for (const id of free) rest.delete(id)
    for (const deps of rest.values()) for (const id of free) deps.delete(id)
  }
}

function findCycle(pending: Graph): string[] {
  const start = [...pending.keys()].sort(byNumber)[0]!
  const path: string[] = []
  const seen = new Map<string, number>()
  let node = start
  while (!seen.has(node)) {
    seen.set(node, path.length)
    path.push(node)
    node = [...pending.get(node)!].sort(byNumber)[0]!
  }
  const cycle = path.slice(seen.get(node))
  const first = cycle.indexOf([...cycle].sort(byNumber)[0]!)
  const rotated = [...cycle.slice(first), ...cycle.slice(0, first)]
  return [...rotated, rotated[0]!]
}
