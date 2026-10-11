import type { LaunchDay } from '../../../src/chain/launches.js'
import { type ChainBlock, type ChainStatus, checkpointHandoffs } from '../state.js'
import { type Pace, typingTime } from './typing.js'

/** Situations on the project page that have a meme of their own. */
export type Moment = 'calm' | 'backlogEmpty' | 'stopped' | 'autopilot' | 'overnight' | 'limit' | 'rerun' | 'checkpoint' | 'spend'

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

/** Stories told in acts, one line each: the picture freezes the voyage and keeps its last act for good, the others go like a general line. */
export const PLAYS = ['picture', 'spoons'] as const
export type Play = (typeof PLAYS)[number]

/** Dialogues in the look of Claude Code: the human's lines appear whole, the agent's are typed, and they pile up. */
export const CHATS = ['keepGoing', 'areYouSure', 'fixTest', 'recommended'] as const
export type Chat = (typeof CHATS)[number]
export type ChatLine = { human: string } | { agent: string }

/** A general line by its index, the line for the driving boat, an act of a play, a chat, or a moment's line. */
export type Meme = { line: number } | { drive: true } | { play: Play; act: number } | { chat: Chat } | { moment: Moment }

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
  if (longestRun(open) >= RERUN_SESSIONS) moments.push('rerun')
  if (open.some((block) => checkpointHandoffs(block.sessions) > 0)) moments.push('checkpoint')
  if ((scene.monthCost ?? 0) >= SPEND_USD) moments.push('spend')
  return moments
}

/** Half the draws go to the moments, when there are any; the rest to the general lines, the drive and the plays. Never `previous` again. */
export function pickMeme(moments: Moment[], lines: number, random: () => number, previous?: Meme): Meme {
  const fresh = moments.filter((moment) => !(previous && 'moment' in previous && previous.moment === moment))
  if (fresh.length > 0 && random() < 0.5) return { moment: fresh[Math.floor(random() * fresh.length)]! }
  // The drive, the plays and then the chats are the general lines after the last one.
  const chats = lines + 1 + PLAYS.length
  const skip =
    previous === undefined || 'moment' in previous
      ? -1
      : 'drive' in previous
        ? lines
        : 'play' in previous
          ? lines + 1 + PLAYS.indexOf(previous.play)
          : 'chat' in previous
            ? chats + CHATS.indexOf(previous.chat)
            : previous.line
  const count = chats + CHATS.length
  let index = Math.floor(random() * (skip < 0 ? count : count - 1))
  if (skip >= 0 && index >= skip) index += 1
  if (index < lines) return { line: index }
  if (index === lines) return { drive: true }
  return index < chats ? { play: PLAYS[index - lines - 1]!, act: 0 } : { chat: CHATS[index - chats]! }
}

export function chatTime(chat: ChatLine[], { charMs, pauseMs }: Pace): number {
  const typed = chat.reduce((sum, line) => sum + ('agent' in line ? line.agent.length : 0), 0)
  return typed * charMs + Math.max(0, chat.length - 1) * pauseMs
}

/** How a chat is erased: selected a line per `lineMs` from the bottom, held selected `holdMs`, then deleted at once. */
export const CHAT_SELECT = { lineMs: 150, holdMs: 700 }

/**
 * How many characters of each chat line show `elapsed` ms after the start (-1 — the line is not there) and how many of
 * the last lines are selected. From `eraseAt` ms on (`null` — never) the chat is selected and deleted.
 */
export function chatAt(chat: ChatLine[], elapsed: number, pace: Pace, eraseAt: number | null): { said: number[]; selected: number } {
  const said = chat.map(() => -1)
  if (eraseAt !== null && elapsed >= eraseAt + (chat.length - 1) * CHAT_SELECT.lineMs + CHAT_SELECT.holdMs) return { said, selected: 0 }
  let left = eraseAt === null ? elapsed : Math.min(elapsed, eraseAt)
  for (const [index, line] of chat.entries()) {
    if ('human' in line) said[index] = line.human.length
    else {
      said[index] = Math.min(line.agent.length, Math.floor(left / pace.charMs))
      left -= line.agent.length * pace.charMs
    }
    left -= pace.pauseMs
    if (left < 0) break
  }
  const selected = eraseAt === null || elapsed < eraseAt ? 0 : Math.min(chat.length, Math.floor((elapsed - eraseAt) / CHAT_SELECT.lineMs) + 1)
  return { said, selected }
}

/** Which way the sea with the boat and the cloud move, per tick. */
export interface Motion {
  sea: -1 | 0 | 1
  cloud: -1 | 0 | 1
}

/**
 * How the voyage moves `elapsed` ms into act `act` of `acts` typed from `parts`. Only the picture moves it its own way: in
 * the first act the sea stops as the second part starts and the cloud once it is typed, in the middle ones all stands
 * still, in the last all runs backwards.
 */
export function playMotion(play: Play, act: number, acts: number, elapsed: number, parts: string[], pace: Pace): Motion {
  if (play !== 'picture') return { sea: 1, cloud: 1 }
  if (act === acts - 1) return { sea: -1, cloud: -1 }
  if (act > 0) return { sea: 0, cloud: 0 }
  const secondPart = typingTime(parts.slice(0, 1), pace) + pace.pauseMs
  return { sea: elapsed < secondPart ? 1 : 0, cloud: elapsed < typingTime(parts, pace) ? 1 : 0 }
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
