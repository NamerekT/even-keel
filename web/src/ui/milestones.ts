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

export function milestoneView<T extends { id: string; milestone: string | null; open: boolean }>(
  blocks: T[],
  revealed: number,
  focus = '',
): MilestoneView<T> {
  const runs: Section<T>[] = []
  for (const block of blocks) {
    const last = runs.at(-1)
    if (last !== undefined && last.milestone === block.milestone) last.blocks.push(block)
    else runs.push({ milestone: block.milestone, blocks: [block] })
  }
  const current = runs.findIndex((run) => run.milestone !== null && run.blocks.some((block) => block.open))
  const focused = runs.findIndex((run) => run.blocks.some((block) => block.id === focus))
  const reveal = current < 0 ? 0 : Math.max(revealed, focused - current)
  const shown = current < 0 ? runs.length : Math.min(runs.length, current + 1 + reveal)
  return {
    sections: runs.slice(0, shown),
    next: runs[shown] ?? null,
    titled: blocks.some((block) => block.milestone !== null),
    revealed: reveal,
    fixed: current < 0 ? runs.length : current + 1,
  }
}
