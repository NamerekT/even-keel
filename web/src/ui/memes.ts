import type { LaunchDay } from '../../../src/chain/launches.js'
import type { LimitWindow } from '../../../src/limits/model.js'
import { type ChainBlock, type ChainStatus, checkpointHandoffs } from '../state.js'
import { type Pace, typingTime } from './typing.js'

/** Situations on the project page that have a meme of their own. */
export type Moment = 'calm' | 'backlogEmpty' | 'stopped' | 'autopilot' | 'overnight' | 'limit' | 'rerun' | 'checkpoint' | 'choice' | 'spend'

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

/**
 * Stories told in acts, one line each, piled up like a chat's lines: the picture freezes the voyage and keeps the whole
 * pile for good, the others are erased like a chat after their last act.
 */
export const PLAYS = ['picture', 'spoons', 'slip', 'reset'] as const
export type Play = (typeof PLAYS)[number]

/**
 * Dialogues in the look of Claude Code: the human's lines appear whole, the agent's are typed, and they pile up. The
 * `limits` chat is drawn only while the header's five-hour window is nearly spent (`limitsFixReset`).
 */
export const CHATS = ['keepGoing', 'areYouSure', 'justAsking', 'fixTest', 'recommended', 'limits'] as const
export type Chat = (typeof CHATS)[number]
export type ChatLine = { human: string } | { agent: string }

/** A general line by its index, the line for the driving boat, an act of a play, a chat, or a moment's line. */
export type Meme = { line: number } | { drive: true } | { play: Play; act: number } | { chat: Chat; reset?: string } | { moment: Moment }

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
  if (open.some((block) => block.session?.asking === true)) moments.push('choice')
  if ((scene.monthCost ?? 0) >= SPEND_USD) moments.push('spend')
  return moments
}

/** A moment stays true for as long as the page stands still, so more than this share of the draws makes it a refrain. */
const MOMENT_SHARE = 0.25

/**
 * A quarter of the draws go to the moments, when there are any; the rest to the general lines, the drive, the plays and the
 * chats, the limits chat only with `limitsReset`, which its last line names. Never `previous` again.
 */
export function pickMeme(moments: Moment[], lines: number, random: () => number, previous?: Meme, { limitsReset = null }: { limitsReset?: string | null } = {}): Meme {
  const fresh = moments.filter((moment) => !(previous && 'moment' in previous && previous.moment === moment))
  if (fresh.length > 0 && random() < MOMENT_SHARE) return { moment: fresh[Math.floor(random() * fresh.length)]! }
  const offered: readonly Chat[] = limitsReset === null ? CHATS.filter((chat) => chat !== 'limits') : CHATS
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
            ? offered.includes(previous.chat) ? chats + offered.indexOf(previous.chat) : -1
            : previous.line
  const count = chats + offered.length
  let index = Math.floor(random() * (skip < 0 ? count : count - 1))
  if (skip >= 0 && index >= skip) index += 1
  if (index < lines) return { line: index }
  if (index === lines) return { drive: true }
  if (index < chats) return { play: PLAYS[index - lines - 1]!, act: 0 }
  const chat = offered[index - chats]!
  return chat === 'limits' ? { chat, reset: limitsReset! } : { chat }
}

/** When each line of a chat starts, ms after the chat does: a pause after the line before it is typed. */
export function chatStarts(chat: ChatLine[], { charMs, pauseMs }: Pace): number[] {
  let next = 0
  return chat.map((line) => {
    const start = next
    next = start + ('agent' in line ? line.agent.length : 0) * charMs + pauseMs
    return start
  })
}

/** When the last line of a chat is typed, ms after its start. */
export function chatTime(chat: ChatLine[], pace: Pace, starts = chatStarts(chat, pace)): number {
  const last = chat.at(-1)
  if (last === undefined) return 0
  return starts.at(-1)! + ('agent' in last ? last.agent.length : 0) * pace.charMs
}

/**
 * The limits chat (BTN-1510): the agent "fixes" the limits and they really leave the header for `goneMs`. From `percent`
 * of the five-hour window. Its third line starts `gapMs` after the second is typed and takes the limits away, the human
 * asks `askMs` after that, and the last line brings them back.
 */
export const LIMITS_FIX = { percent: 90, gapMs: 2000, askMs: 8000, goneMs: 10_000 }

/** The beats of the limits chat's five lines, in the shape of `chatStarts`. */
export function limitsFixStarts(chat: ChatLine[], pace: Pace): number[] {
  const starts = chatStarts(chat.slice(0, 2), pace)
  const gone = chatTime(chat.slice(0, 2), pace, starts) + LIMITS_FIX.gapMs
  return [...starts, gone, gone + LIMITS_FIX.askMs, gone + LIMITS_FIX.goneMs]
}

export function chatStartsOf(name: Chat, chat: ChatLine[], pace: Pace): number[] {
  return name === 'limits' ? limitsFixStarts(chat, pace) : chatStarts(chat, pace)
}

/** Whether the header's limits are away `elapsed` ms into the limits chat timed by `starts`. */
export function limitsGone(starts: number[], elapsed: number): boolean {
  return elapsed >= starts[2]! && elapsed < starts[4]!
}

/**
 * The reset the limits chat names, in the CLI's words ("2pm", "9:30am"), when the header's five-hour window is spent from
 * `LIMITS_FIX.percent` on; `null` — no chat: no window, outdated limits or a reset already past.
 */
export function limitsFixReset(five: { window: LimitWindow | null; outdated: boolean } | null, now: Date): string | null {
  const window = five?.window
  if (!window || five.outdated || window.usedPercentage < LIMITS_FIX.percent) return null
  const reset = new Date(window.resetsAt)
  if (!(reset.getTime() > now.getTime())) return null
  const hour = reset.getHours() % 12 || 12
  const minutes = reset.getMinutes()
  return `${hour}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`}${reset.getHours() < 12 ? 'am' : 'pm'}`
}

/** How a chat is erased: selected a line per `lineMs` from the bottom, held selected `holdMs`, then deleted at once. */
export const CHAT_SELECT = { lineMs: 150, holdMs: 700 }

/**
 * How many characters of each chat line show `elapsed` ms after the start (-1 — the line is not there) and how many of
 * the last lines are selected, the lines starting at `starts`. From `eraseAt` ms on (`null` — never) the chat is selected
 * and deleted.
 */
export function chatAt(chat: ChatLine[], elapsed: number, pace: Pace, eraseAt: number | null, starts = chatStarts(chat, pace)): { said: number[]; selected: number } {
  const said = chat.map(() => -1)
  const selected = selectionAt(chat.length, elapsed, eraseAt)
  if (selected === null) return { said, selected: 0 }
  const until = eraseAt === null ? elapsed : Math.min(elapsed, eraseAt)
  for (const [index, line] of chat.entries()) {
    const left = until - starts[index]!
    if (left < 0) break
    said[index] = 'human' in line ? line.human.length : Math.min(line.agent.length, Math.floor(left / pace.charMs))
  }
  return { said, selected }
}

/**
 * How many of the last of `lines` piled lines are selected `elapsed` ms in, erased the way `CHAT_SELECT` says from
 * `eraseAt` on (`null` — never); `null` once the pile is deleted.
 */
export function selectionAt(lines: number, elapsed: number, eraseAt: number | null): number | null {
  if (eraseAt === null || elapsed < eraseAt) return 0
  if (elapsed >= eraseAt + (lines - 1) * CHAT_SELECT.lineMs + CHAT_SELECT.holdMs) return null
  return Math.min(lines, Math.floor((elapsed - eraseAt) / CHAT_SELECT.lineMs) + 1)
}

/**
 * When an act typed from `parts` ends, ms after it starts. The acts pile up like a chat's lines: the next one comes a
 * chat's pause after this one is typed; the last one is held `holdMs` before the whole pile is erased.
 */
export function actEnd(parts: string[], pace: Pace, { last, holdMs }: { last: boolean; holdMs: number }): number {
  return typingTime(parts, pace) + (last ? holdMs : pace.pauseMs)
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

/** Which card of its kind each card is on the page, so that neighbours with the same kind take different punchlines. */
export function emptyTurns(kinds: (EmptyCard | null)[]): number[] {
  const seen = new Map<EmptyCard | null, number>()
  return kinds.map((kind) => {
    const turn = seen.get(kind) ?? 0
    seen.set(kind, turn + 1)
    return turn
  })
}

/** The punchline of a turn; once the variants run out, the card says only its setup. */
export function punchline(variants: readonly string[], turn: number): string | null {
  return variants[turn] ?? null
}

/** What the home page knows to joke about. */
export interface Harbor {
  /** Project ids, the keys of `launches`' counts. */
  projects: string[]
  /** What a person reads a project by, per id (`projectLabels`); an id it lacks is read as is. */
  labels: Readonly<Record<string, string>>
  launches: LaunchDay[]
  /** Open questions across all projects. */
  questions: number
  /** The five-hour limit used, in percent; `null` — unknown. */
  fiveHour: number | null
}

export type HarborMeme =
  | { kind: 'self' }
  | { kind: 'peak'; day: string; count: number }
  | { kind: 'favorite'; project: string; label: string; count: number; total: number }
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
      if (count >= total * FAVORITE.share) memes.push({ kind: 'favorite', project, label: harbor.labels[project] ?? project, count, total })
    }
  }
  if (harbor.questions >= QUESTIONS) memes.push({ kind: 'questions', count: harbor.questions })
  if (harbor.fiveHour !== null && harbor.fiveHour >= LIMIT_PERCENT) memes.push({ kind: 'limit', percent: Math.round(harbor.fiveHour) })
  return memes
}
