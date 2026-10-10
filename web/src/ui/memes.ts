import { type ChainBlock, type ChainStatus, checkpointHandoffs } from '../state.js'

/** Situations on the project page that have a meme of their own. */
export type Moment = 'calm' | 'backlogEmpty' | 'stopped' | 'autopilot' | 'overnight' | 'limit' | 'appointment' | 'rerun' | 'checkpoint' | 'spend'

export interface Scene {
  /** Whether the service has read the project's chain. */
  loaded: boolean
  blocks: ChainBlock[]
  backlog: number
  status: ChainStatus
  unattended: boolean
  /** What tasks cost over the last 30 days at token prices, in dollars; `null` — not read yet. */
  monthCost: number | null
}

/** A general line by its index, the line for the driving boat, or a moment's line. */
export type Meme = { line: number } | { drive: true } | { moment: Moment }

const RERUN_SESSIONS = 3
const SPEND_USD = 1000

/** The most sessions any open task has had. */
export function longestRun(blocks: ChainBlock[]): number {
  return Math.max(0, ...blocks.filter((block) => block.open).map((block) => block.sessions.length))
}

export function momentsOf(scene: Scene): Moment[] {
  if (!scene.loaded) return []
  const open = scene.blocks.filter((block) => block.open || block.locked)
  if (open.length === 0 && scene.backlog === 0) return ['calm']

  const moments: Moment[] = []
  const { status } = scene
  if (open.length > 0 && scene.backlog === 0) moments.push('backlogEmpty')
  if (status.kind === 'idle' && open.length > 0) moments.push('stopped')
  if (status.kind === 'running') moments.push(status.limitUntil !== null ? 'limit' : scene.unattended ? 'overnight' : 'autopilot')
  if (open.some((block) => block.question || block.skipped)) moments.push('appointment')
  if (longestRun(open) >= RERUN_SESSIONS) moments.push('rerun')
  if (open.some((block) => checkpointHandoffs(block.sessions) > 0)) moments.push('checkpoint')
  if ((scene.monthCost ?? 0) >= SPEND_USD) moments.push('spend')
  return moments
}

/** Half the draws go to the moments, when there are any; the rest to the general lines and the drive. */
export function pickMeme(moments: Moment[], lines: number, random: () => number): Meme {
  if (moments.length > 0 && random() < 0.5) return { moment: moments[Math.floor(random() * moments.length)]! }
  const index = Math.floor(random() * (lines + 1))
  return index === lines ? { drive: true } : { line: index }
}
