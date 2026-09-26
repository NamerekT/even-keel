import type { HulyTask } from '../huly/model.js'

export const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function chainOrder(tasks: HulyTask[], preferred: string[] = []): string[] {
  const blockers = blockersWithin(tasks)
  const rank = new Map(preferred.map((id, index) => [id, index]))
  const compare = (a: string, b: string) =>
    (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || byNumber(a, b)

  const pending = new Map([...blockers].map(([id, deps]) => [id, new Set(deps)]))
  const order: string[] = []
  while (pending.size > 0) {
    const ready = [...pending].filter(([, deps]) => deps.size === 0).map(([id]) => id)
    if (ready.length === 0) throw new Error(`chain: cycle: ${findCycle(pending).join(' → ')}`)
    const next = ready.sort(compare)[0]!
    order.push(next)
    pending.delete(next)
    for (const deps of pending.values()) deps.delete(next)
  }
  return order
}

export function checkOrder(tasks: HulyTask[], order: string[]): void {
  const blockers = blockersWithin(tasks)
  const position = new Map<string, number>()
  for (const [index, id] of order.entries()) {
    if (!blockers.has(id)) throw new Error(`chain: ${id} is not an open task of this chain`)
    if (position.has(id)) throw new Error(`chain: ${id} appears twice`)
    position.set(id, index)
  }
  for (const [id, index] of position) {
    for (const blocker of blockers.get(id) ?? []) {
      const blockerIndex = position.get(blocker)
      if (blockerIndex !== undefined && blockerIndex > index) {
        throw new Error(`chain: ${id} cannot go before ${blocker}, which blocks it`)
      }
    }
  }
}

function blockersWithin(tasks: HulyTask[]): Map<string, string[]> {
  const ids = new Set(tasks.map((task) => task.id))
  return new Map(tasks.map((task) => [task.id, task.blockedBy.filter((id) => ids.has(id))]))
}

function findCycle(pending: Map<string, Set<string>>): string[] {
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
