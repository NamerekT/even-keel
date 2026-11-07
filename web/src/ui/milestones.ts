export interface Section<T> {
  milestone: string | null
  blocks: T[]
}

export interface MilestoneView<T> {
  sections: Section<T>[]
  next: Section<T> | null
  titled: boolean
  revealed: number
  /** Leading sections that are always shown; the ones after them were revealed and can be folded. */
  fixed: number
}

/** The project's milestones no task carries (`names`) and the order of all its milestones, to place them by. */
export interface EmptyMilestones {
  names: readonly string[]
  order: readonly string[]
}

const NO_EMPTY: EmptyMilestones = { names: [], order: [] }

export function milestoneView<T extends { id: string; milestone: string | null; open: boolean }>(
  blocks: T[],
  revealed: number,
  focus = '',
  empty: EmptyMilestones = NO_EMPTY,
): MilestoneView<T> {
  const runs: Section<T>[] = []
  for (const block of blocks) {
    const last = runs.at(-1)
    if (last !== undefined && last.milestone === block.milestone) last.blocks.push(block)
    else runs.push({ milestone: block.milestone, blocks: [block] })
  }
  for (const name of empty.names) runs.splice(emptyIndex(runs, name, empty.order), 0, { milestone: name, blocks: [] })
  const current = runs.findIndex((run) => run.milestone !== null && run.blocks.some((block) => block.open))
  const focused = runs.findIndex((run) => run.blocks.some((block) => block.id === focus))
  const reveal = current < 0 ? 0 : Math.max(revealed, focused - current)
  const shown = current < 0 ? runs.length : Math.min(runs.length, current + 1 + reveal)
  return {
    sections: runs.slice(0, shown),
    next: runs[shown] ?? null,
    titled: runs.some((run) => run.milestone !== null),
    revealed: reveal,
    fixed: current < 0 ? runs.length : current + 1,
  }
}

/** An empty milestone stands before the first milestone later in the order, otherwise right after the last milestone. */
function emptyIndex(runs: Section<unknown>[], name: string, order: readonly string[]): number {
  const rank = (milestone: string) => {
    const at = order.findIndex((each) => each.toLocaleLowerCase() === milestone.toLocaleLowerCase())
    return at < 0 ? order.length : at
  }
  const own = rank(name)
  const later = runs.findIndex((run) => run.milestone !== null && rank(run.milestone) > own)
  if (later >= 0) return later
  return runs.findLastIndex((run) => run.milestone !== null) + 1
}
