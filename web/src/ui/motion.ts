import type { BlockLamp } from '../state.js'

/** One look at the chain: what the page last showed the user, or shows now. */
export interface Frame<T> {
  /** The chain outside the folded archive, in order. */
  order: string[]
  items: ReadonlyMap<string, T>
  /** What is on screen: a folded milestone is not, an unfolded archive page is. */
  shown: ReadonlySet<string>
  /** Closed tasks of the whole chain, the archived ones included. */
  closed: ReadonlySet<string>
  current: string | null
  /** The tasks the lanes run now (`underWay`): a paused lane's task whose session stands is not among them. */
  running: ReadonlySet<string>
  /** The lane tasks that share the frame "Under way" (`runningGroup`); empty under two. */
  grouped: ReadonlySet<string>
}

export type Beat = 'finish' | 'part' | 'leave' | 'enter' | 'take'

export interface Leaving<T> {
  item: T
  /** The task it stood after that is still on screen; `null` — the top of the list. */
  after: string | null
  archived: boolean
}

/** The key prefixes the chain's tasks left and got at once: the project's tracker switched and its tasks were renamed (BTN-1200). */
export interface Moved {
  from: string[]
  to: string[]
}

/** The summary of what changed out of sight: full counts, the tasks out of sight on the page included. */
export interface Away {
  entered: number
  archived: number
  removed: number
  /** The renamed tasks are in none of the counts. */
  moved: Moved | null
}

export interface Motion<T> {
  entered: string[]
  finished: string[]
  taken: string | null
  /** Rows that came into the running group: they move to it on the take beat, then their own frame melts. */
  joined: string[]
  /** The one running row whose own frame melts as the group forms around it. */
  merged: string[]
  /** Rows their lane let go, still in sight: their own frame first, then they move out. */
  parted: string[]
  /** The last row of a group that broke up: its own frame comes back as the others move. */
  alone: string[]
  leaving: Leaving<T>[]
  /** Too much changed out of sight: no beats, a summary and a soft mark on the new tasks instead. */
  quiet: Away | null
  /** When each beat starts, so a handover reads as finish, archive, take rather than one jump. */
  delays: Partial<Record<Beat, number>>
}

export type Mark = 'enter' | 'fresh' | 'finish' | 'take' | 'join' | 'merge' | 'part' | 'solo'

export interface Stage<T> {
  /** Leaving copies of all running motions, the newest motion's first. */
  leaving: (Leaving<T> & { beat: number })[]
  /** The marks on each task, each with the delay of its own beat. */
  marks: ReadonlyMap<string, ReadonlyMap<Mark, number>>
  quiet: Away | null
  /** When the archive count bumps, for the oldest motion that archives a task. */
  bump: number | null
}

export interface Slot<T> {
  block: T
  leaving: boolean
}

/** One step of the chain's motion, `--motion-step`: a take's frame, a leave, a row moving into the running group or out. */
export const STEP_MS = 250
/** From one beat to the next: each starts as the one before has done its step. */
export const BEAT_MS = STEP_MS
/** How long the Done stamp takes to draw (`stamp-draw` in chain.css): a done row leaves the running group after it. */
export const STAMP_MS = 450
/** The longest beat: the Done stamp, drawn and faded (`stamp-fade` ends 1.4 s in). */
export const BEAT_LENGTH_MS = 1_400
export const QUIET_MS = 6_000
const QUIET_OVER = 5
const BEATS: Beat[] = ['finish', 'part', 'leave', 'enter', 'take']

/**
 * The net change between two looks at the chain; what came and went in between is not in it. A task renamed by a tracker
 * switch neither left nor came: the ids under the prefixes the switch swapped are left out, and the summary tells of it.
 */
export function motionOf<T extends { id: string; lamp: BlockLamp }>(
  prev: Frame<T>,
  next: Frame<T>,
  skip: ReadonlySet<string>,
): Motion<T> | null {
  const before = new Set(prev.order)
  const after = new Set(next.order)
  const moved = movedOf(prev.order, next.order)
  const swapped = new Set(moved === null ? [] : [...moved.from, ...moved.to])
  const kept = (id: string) => !swapped.has(prefixOf(id))
  const came = next.order.filter((id) => !before.has(id) && !skip.has(id) && kept(id))
  const left = prev.order.filter((id) => !after.has(id) && kept(id))
  const entered = came.filter((id) => next.shown.has(id))
  const leaving = left
    .filter((id) => prev.shown.has(id) && !next.shown.has(id))
    .map((id) => ({ item: prev.items.get(id)!, after: anchorOf(prev.order, id, next.shown), archived: next.closed.has(id) }))
  const finished = next.order.filter(
    (id) => before.has(id) && next.shown.has(id) && next.items.get(id)!.lamp === 'done' && prev.items.get(id)!.lamp !== 'done',
  )
  // A row in the running group gets no frame of its own drawn, nor does a lane task that only came to lead the chain.
  const lead = next.current
  const taken = lead !== null && lead !== prev.current && next.shown.has(lead) && !prev.running.has(lead) && !next.grouped.has(lead) ? lead : null
  const inSight = (id: string) => next.shown.has(id) && kept(id)
  const joined = [...next.grouped].filter((id) => !prev.running.has(id) && inSight(id))
  const merged = joined.length === 0 ? [] : [...next.grouped].filter((id) => prev.running.has(id) && !prev.grouped.has(id) && inSight(id))
  const parted = [...prev.grouped].filter((id) => !next.running.has(id) && inSight(id))
  const alone = [...prev.grouped].filter((id) => next.running.has(id) && !next.grouped.has(id) && inSight(id))
  const grouping = { joined, merged, parted, alone }

  if (moved !== null || entered.length + leaving.length > QUIET_OVER) {
    const archived = left.filter((id) => next.closed.has(id)).length
    const quiet = { entered: came.length, archived, removed: left.length - archived, moved }
    return { entered, finished: [], taken: null, joined: [], merged: [], parted: [], alone: [], leaving: [], quiet, delays: {} }
  }
  if (entered.length + leaving.length + finished.length + joined.length + parted.length + alone.length === 0 && taken === null) return null

  const present: Record<Beat, boolean> = {
    finish: finished.length > 0,
    part: parted.length > 0,
    leave: leaving.length > 0,
    enter: entered.length > 0,
    take: taken !== null || joined.length > 0,
  }
  const delays: Partial<Record<Beat, number>> = {}
  let at = 0
  for (const beat of BEATS.filter((each) => present[each])) {
    delays[beat] = at
    // A done row leaves the group once its stamp is drawn.
    at += beat === 'finish' && present.part ? STAMP_MS : BEAT_MS
  }
  return { entered, finished, taken, ...grouping, leaving, quiet: null, delays }
}

/**
 * When a row starts to move to its new place: a joining row on the take beat, a parting one a step after its own frame
 * came back, the rows they push aside with the first of them.
 */
export function moveDelay(motion: Motion<unknown>, id: string): number {
  const join = motion.delays.take ?? 0
  const part = (motion.delays.part ?? 0) + STEP_MS
  if (motion.joined.includes(id)) return join
  if (motion.parted.includes(id)) return part
  return Math.min(motion.joined.length > 0 ? join : Infinity, motion.parted.length > 0 ? part : Infinity, motion.alone.length > 0 ? part : Infinity)
}

/** The motion moves rows into the running group or out of it. */
export function regroups(motion: Motion<unknown>): boolean {
  return motion.joined.length + motion.parted.length + motion.alone.length > 0
}

/** A prefix gone from the chain while another came: a feed that ends as another begins looks the same, and is rare. */
function movedOf(prev: string[], next: string[]): Moved | null {
  const was = new Set(prev.map(prefixOf))
  const is = new Set(next.map(prefixOf))
  const from = [...was].filter((prefix) => !is.has(prefix))
  const to = [...is].filter((prefix) => !was.has(prefix))
  return from.length > 0 && to.length > 0 ? { from, to } : null
}

function prefixOf(id: string): string {
  const dash = id.lastIndexOf('-')
  return dash < 0 ? '' : id.slice(0, dash)
}

/** How long the page keeps the marks of a motion. */
export function motionSpan(motion: Motion<unknown>): number {
  if (motion.quiet !== null) return QUIET_MS
  return Math.max(0, ...Object.values(motion.delays)) + BEAT_LENGTH_MS
}

/** All motions still playing, merged: a change that comes mid-motion adds to it instead of cutting it short. */
export function stageOf<T>(motions: Motion<T>[]): Stage<T> {
  const leaving: Stage<T>['leaving'] = []
  const marks = new Map<string, Map<Mark, number>>()
  const mark = (id: string, kind: Mark, beat: number) => marks.set(id, (marks.get(id) ?? new Map<Mark, number>()).set(kind, beat))
  let quiet: Away | null = null
  let bump: number | null = null
  for (const motion of motions) {
    const at = (beat: Beat) => motion.delays[beat] ?? 0
    leaving.unshift(...motion.leaving.map((each) => ({ ...each, beat: at('leave') })))
    for (const id of motion.entered) mark(id, motion.quiet === null ? 'enter' : 'fresh', at('enter'))
    for (const id of motion.finished) mark(id, 'finish', at('finish'))
    if (motion.taken !== null) mark(motion.taken, 'take', at('take'))
    for (const id of motion.joined) mark(id, 'join', at('take'))
    for (const id of motion.merged) mark(id, 'merge', at('take'))
    for (const id of motion.parted) mark(id, 'part', at('part'))
    for (const id of motion.alone) mark(id, 'solo', motion.parted.length > 0 ? at('part') + STEP_MS : 0)
    if (motion.quiet !== null) quiet = motion.quiet
    if (bump === null && motion.leaving.some((each) => each.archived)) bump = at('leave')
  }
  return { leaving, marks, quiet, bump }
}

/**
 * The sections with the leaving tasks back where they stood, until they fold away. A copy may stand after
 * another copy, so the copies of later motions go first; a copy whose task is back or whose anchor is gone is dropped.
 */
export function placeLeaving<T extends { id: string }>(sections: T[][], leaving: Leaving<T>[]): Slot<T>[][] {
  const placed: Slot<T>[][] = sections.map((blocks) => blocks.map((block) => ({ block, leaving: false })))
  const anchors = new Map<string, string | null>()
  for (const each of leaving) {
    if (placed.some((section) => section.some((slot) => slot.block.id === each.item.id))) continue
    const spot = spotOf(placed, each.after)
    if (spot === null) continue
    const { section, index } = spot
    const behind = new Set([each.after])
    let at = index
    while (at < section.length && section[at]!.leaving && behind.has(anchors.get(section[at]!.block.id)!)) behind.add(section[at++]!.block.id)
    section.splice(at, 0, { block: each.item, leaving: true })
    anchors.set(each.item.id, each.after)
  }
  return placed
}

function spotOf<T extends { id: string }>(placed: Slot<T>[][], after: string | null): { section: Slot<T>[]; index: number } | null {
  if (after === null) return placed.length === 0 ? null : { section: placed[0]!, index: 0 }
  for (const section of placed) {
    const index = section.findIndex((slot) => slot.block.id === after)
    if (index >= 0) return { section, index: index + 1 }
  }
  return null
}

function anchorOf(order: string[], id: string, shown: ReadonlySet<string>): string | null {
  for (let index = order.indexOf(id) - 1; index >= 0; index--) {
    if (shown.has(order[index]!)) return order[index]!
  }
  return null
}
