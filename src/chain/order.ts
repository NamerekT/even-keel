import { fail } from '../notice/notice.js'
import { PRIORITIES, type Task, type TaskMilestone } from '../tracker/model.js'

const numeric = new Intl.Collator('en', { numeric: true })
export const byNumber = (a: string, b: string) => numeric.compare(a, b)

type Graph = Map<string, Set<string>>

export function chainOrder(tasks: Task[], preferred: string[] = []): string[] {
  const plan = planOf(tasks)
  const rank = new Map(preferred.map((id, index) => [id, index]))
  const priority = priorityOf(tasks)
  const compare = (a: string, b: string) =>
    (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
    (plan.ranks.get(a) ?? Infinity) - (plan.ranks.get(b) ?? Infinity) ||
    priority(a) - priority(b) ||
    byNumber(a, b)

  const pending: Graph = new Map([...plan.blockers].map(([id, deps]) => [id, new Set([...deps, ...plan.earlier.get(id)!])]))
  const waiting = new Map<string, string[]>()
  const ready = new Set<string>()
  for (const [id, deps] of pending) {
    if (deps.size === 0) ready.add(id)
    for (const dep of deps) {
      const list = waiting.get(dep)
      if (list === undefined) waiting.set(dep, [id])
      else list.push(id)
    }
  }
  const order: string[] = []
  while (pending.size > 0) {
    if (ready.size === 0) throw deadlock(pending, plan, tasks)
    let next: string | undefined
    for (const id of ready) if (next === undefined || compare(id, next) < 0) next = id
    order.push(next!)
    ready.delete(next!)
    pending.delete(next!)
    for (const id of waiting.get(next!) ?? []) {
      const deps = pending.get(id)
      if (deps === undefined) continue
      deps.delete(next!)
      if (deps.size === 0) ready.add(id)
    }
  }
  return order
}

export function withFresh(tasks: Task[], order: string[], fresh: string[], pinned: number): string[] {
  const priority = priorityOf(tasks)
  const result = [...order]
  const lastFirst = [...fresh].sort((a, b) => priority(b) - priority(a) || byNumber(b, a))
  for (const id of lastFirst) {
    const at = result.findIndex((other, index) => index >= pinned && priority(other) >= priority(id))
    result.splice(at === -1 ? result.length : at, 0, id)
  }
  return result
}

export function checkOrder(tasks: Task[], order: string[]): void {
  const plan = planOf(tasks)
  const milestones = milestonesById(tasks)
  const position = new Map<string, number>()
  for (const [index, id] of order.entries()) {
    if (!plan.blockers.has(id)) throw fail('order.notOpen', { task: id })
    if (position.has(id)) throw fail('order.twice', { task: id })
    position.set(id, index)
  }
  const later = (other: string, index: number) => (position.get(other) ?? -1) > index
  for (const [id, index] of position) {
    const blocker = plan.blockers.get(id)!.find((other) => later(other, index))
    if (blocker !== undefined) throw fail('order.blocked', { task: id, blocker })
    const earlier = plan.earlier.get(id)!.find((other) => later(other, index))
    if (earlier !== undefined) {
      throw fail('order.milestone', { task: id, milestone: String(milestones.get(id)), earlier, earlierMilestone: String(milestones.get(earlier)) })
    }
  }
}

export function nextTask(tasks: Task[], order: string[], holding: string[]): string | undefined {
  const blockers = new Map(tasks.map((task) => [task.id, task.blockedBy]))
  const held = new Set(holding)
  for (const id of order) {
    if (!held.has(id) && !(blockers.get(id) ?? []).some((other) => held.has(other))) return id
    held.add(id)
  }
  return undefined
}

export function openBlockers(tasks: Task[], id: string): string[] {
  const ids = new Set(tasks.map((task) => task.id))
  return tasks.find((task) => task.id === id)?.blockedBy.filter((other) => ids.has(other)) ?? []
}

export function waitingBlockers(chain: Task[], outside: Task[]): Task[] {
  const byId = new Map(outside.map((task) => [task.id, task]))
  const found = new Map<string, Task>()
  const visit = (blockers: string[]) => {
    for (const id of blockers) {
      const blocker = byId.get(id)
      if (blocker === undefined || found.has(id)) continue
      found.set(id, blocker)
      visit(blocker.blockedBy)
    }
  }
  for (const task of chain) visit(task.blockedBy)
  return [...found.values()].sort((a, b) => byNumber(a.id, b.id))
}

export function withWaiting(order: string[], waiting: string[], blockers: ReadonlyMap<string, readonly string[]>): string[] {
  if (waiting.length === 0) return order
  const kept = new Set(waiting)
  const holds = new Map(waiting.map((id) => [id, [] as string[]]))
  for (const id of [...order, ...waiting]) {
    for (const blocker of blockers.get(id) ?? []) if (kept.has(blocker)) holds.get(blocker)!.push(id)
  }
  const position = new Map(order.map((id, index) => [id, index]))
  const first = new Map<string, number>()
  const firstHeld = (id: string): number => {
    if (position.has(id)) return position.get(id)!
    if (first.has(id)) return first.get(id)!
    first.set(id, Infinity)
    const index = Math.min(Infinity, ...holds.get(id)!.map(firstHeld))
    first.set(id, index)
    return index
  }
  const before = new Map<number, string[]>()
  for (const id of [...waiting].sort(byNumber)) {
    const index = firstHeld(id)
    const group = before.get(index)
    if (group === undefined) before.set(index, [id])
    else group.push(id)
  }
  const placed = (group: string[] | undefined) => (group === undefined ? [] : blockersFirst(group, blockers))
  return [...order.flatMap((id, index) => [...placed(before.get(index)), id]), ...placed(before.get(Infinity))]
}

function blockersFirst(group: string[], blockers: ReadonlyMap<string, readonly string[]>): string[] {
  const rest = [...group]
  const result: string[] = []
  while (rest.length > 0) {
    const free = rest.findIndex((id) => !(blockers.get(id) ?? []).some((other) => rest.includes(other)))
    result.push(...rest.splice(free < 0 ? 0 : free, 1))
  }
  return result
}

export function precedence(tasks: Task[]): Map<string, string[]> {
  const plan = planOf(tasks)
  return new Map([...plan.blockers].map(([id, deps]) => [id, [...deps, ...plan.earlier.get(id)!]]))
}

export function compareMilestones(a: TaskMilestone, b: TaskMilestone): number {
  const left = versionOf(a.label)
  const right = versionOf(b.label)
  const byVersion = left === null || right === null ? Number(left === null) - Number(right === null) : compareVersions(left, right)
  return byVersion || byDate(a.targetDate, b.targetDate) || byNumber(a.label, b.label)
}

function byDate(a: number | null, b: number | null): number {
  if (a === null || b === null) return Number(a === null) - Number(b === null)
  return a - b
}

interface Plan {
  blockers: Map<string, string[]>
  earlier: Map<string, string[]>
  ranks: Map<string, number>
}

function planOf(tasks: Task[]): Plan {
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

function milestoneRanks(tasks: Task[]): Map<string, number> {
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

function priorityOf(tasks: Task[]): (id: string) => number {
  const ranks = new Map(tasks.map((task) => [task.id, PRIORITIES.indexOf(task.priority)]))
  return (id) => ranks.get(id) ?? PRIORITIES.length
}

function milestonesById(tasks: Task[]): Map<string, string> {
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

function deadlock(pending: Graph, plan: Plan, tasks: Task[]): Error {
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
