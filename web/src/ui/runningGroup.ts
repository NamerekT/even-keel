import type { BlockLamp } from '../state.js'

/** The edge of the group: the colour of the state that needs the user most. */
export type GroupTone = 'working' | 'waiting' | 'error'

export interface RunningGroup {
  members: string[]
  tone: GroupTone
}

interface Row {
  id: string
  current: boolean
  lamp: BlockLamp
  halted?: boolean
}

/** A lane runs the row now: a lane's current task, but not one of a paused lane whose session stands (BTN-1617). */
export function underWay(row: Pick<Row, 'current' | 'halted'>): boolean {
  return row.current && row.halted !== true
}

/**
 * The lane tasks that run together and share one frame, "Under way" (BTN-1613): the first unbroken run of rows a lane
 * holds, a question or an error included, a fix of main too; `null` under two, as one running task keeps a frame of its
 * own. The task a fix interrupted is not under way: `underWayFirst` stands it right under the group.
 */
export function runningGroup(rows: readonly Row[]): RunningGroup | null {
  const start = rows.findIndex(underWay)
  if (start < 0) return null
  const end = rows.findIndex((row, index) => index > start && !underWay(row))
  const run = rows.slice(start, end < 0 ? rows.length : end)
  return run.length < 2 ? null : { members: run.map((row) => row.id), tone: groupTone(run) }
}

/** The group of the first section that has one: a milestone's line between running rows parts them. */
export function firstGroup(sections: readonly (readonly Row[])[]): RunningGroup | null {
  for (const rows of sections) {
    const group = runningGroup(rows)
    if (group !== null) return group
  }
  return null
}

export function groupTone(rows: readonly Pick<Row, 'lamp'>[]): GroupTone {
  if (rows.some((row) => row.lamp === 'error' || row.lamp === 'limit')) return 'error'
  return rows.some((row) => row.lamp === 'waiting') ? 'waiting' : 'working'
}
