import type { LaunchDay } from '../../../src/chain/launches.js'
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

/** What a project card says with no task to show: `held` is the plain line, open tasks wait skipped or blocked. */
export type EmptyCard = 'held' | 'shelved' | 'ghost' | 'finished'

export function emptyCard({ done, total, backlog }: { done: number; total: number; backlog: number }): EmptyCard {
  if (total > done) return 'held'
  if (backlog > 0) return 'shelved'
  return total === 0 ? 'ghost' : 'finished'
}

/** What the home page knows to joke about. */
export interface Harbor {
  projects: string[]
  launches: LaunchDay[]
  /** Open questions across all projects. */
  questions: number
  /** The five-hour limit used, in percent; `null` — unknown. */
  fiveHour: number | null
}

export type HarborMeme =
  | { kind: 'self' }
  | { kind: 'peak'; day: string; count: number }
  | { kind: 'favorite'; project: string; count: number; total: number }
  | { kind: 'questions'; count: number }
  | { kind: 'limit'; percent: number }

const PEAK_LAUNCHES = 50
const FAVORITE = { launches: 50, share: 0.75 }
const QUESTIONS = 3
const LIMIT_PERCENT = 50

export function harborMemes(harbor: Harbor): HarborMeme[] {
  const memes: HarborMeme[] = [{ kind: 'self' }]
  const days = harbor.launches.map((day) => ({ day: day.day, count: Object.values(day.counts).reduce((sum, count) => sum + count, 0) }))
  const peak = days.reduce<(typeof days)[number] | null>((best, day) => (best === null || day.count > best.count ? day : best), null)
  if (peak !== null && peak.count >= PEAK_LAUNCHES) memes.push({ kind: 'peak', ...peak })

  const total = days.reduce((sum, day) => sum + day.count, 0)
  if (harbor.projects.length > 1 && total >= FAVORITE.launches) {
    for (const project of harbor.projects) {
      const count = harbor.launches.reduce((sum, day) => sum + (day.counts[project] ?? 0), 0)
      if (count >= total * FAVORITE.share) memes.push({ kind: 'favorite', project, count, total })
    }
  }
  if (harbor.questions >= QUESTIONS) memes.push({ kind: 'questions', count: harbor.questions })
  if (harbor.fiveHour !== null && harbor.fiveHour >= LIMIT_PERCENT) memes.push({ kind: 'limit', percent: Math.round(harbor.fiveHour) })
  return memes
}
