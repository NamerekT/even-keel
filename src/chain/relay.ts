import type { FeedLine } from '../sessions/transcript.js'

export const WARM_CACHE_MS = 55 * 60_000
const HANDOFF_STEPS = 10
const DAY_MS = 24 * 60 * 60_000
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const RESET_PATTERN = /resets\s+(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)\s*(?:\(([^)]+)\))?/i

export const RESUME_PROMPT = 'Лимит сброшен — продолжай с того же места.'

export type RelayAction = 'resume' | 'relay'
export type RelayStep = 'wait' | RelayAction

export interface LimitedSession {
  sessionId: string
  agentId: string
  cwd: string
  workdir: string
  branch: string | null
  transcript: string | null
  limit: { at: string; text: string }
  lastReplyAt: string | null
  recent: FeedLine[]
}

export interface LimitHold {
  at: string
  account: string | null
  resetsAt: string | null
  lastReplyAt: string | null
  then: RelayAction
  acted: RelayAction | null
}

export interface AccountNow {
  email: string | null
  ready: boolean
}

export function holdOf(session: LimitedSession, account: string | null, fallbackReset: string | null): LimitHold {
  const resetsAt = resetTimeOf(session.limit.text, session.limit.at) ?? fallbackReset
  const { lastReplyAt } = session
  const warmAtReset =
    account !== null && resetsAt !== null && lastReplyAt !== null && Date.parse(resetsAt) - Date.parse(lastReplyAt) < WARM_CACHE_MS
  return { at: session.limit.at, account, resetsAt, lastReplyAt, then: warmAtReset ? 'resume' : 'relay', acted: null }
}

export function relayStep(hold: LimitHold, now: Date, account: AccountNow): RelayStep {
  if (hold.acted !== null || !account.ready) return 'wait'
  const switched = hold.account !== null && account.email !== null && account.email !== hold.account
  const reset = hold.resetsAt !== null && now.getTime() >= Date.parse(hold.resetsAt)
  if (!switched && !reset) return 'wait'
  const warm =
    !switched &&
    hold.account !== null &&
    account.email === hold.account &&
    hold.lastReplyAt !== null &&
    now.getTime() - Date.parse(hold.lastReplyAt) < WARM_CACHE_MS
  return warm ? 'resume' : 'relay'
}

export function resetTimeOf(text: string, at: string): string | null {
  const match = RESET_PATTERN.exec(text)
  if (match === null) return null
  const [, monthName, dayText, hourText, minuteText, meridiem, zoneText] = match
  const zone = zoneText?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone
  const hour = (Number(hourText) % 12) + (meridiem!.toLowerCase() === 'pm' ? 12 : 0)
  const minute = Number(minuteText ?? 0)
  const since = Date.parse(at)
  if (Number.isNaN(since) || hour > 23 || minute > 59) return null

  try {
    const today = wallDate(since, zone)
    if (monthName === undefined) {
      let reset = wallToUtc(today.year, today.month, today.day, hour, minute, zone)
      if (reset <= since) reset = wallToUtc(today.year, today.month, today.day + 1, hour, minute, zone)
      return new Date(reset).toISOString()
    }
    const month = MONTHS.indexOf(monthName.toLowerCase())
    if (month < 0) return null
    let reset = wallToUtc(today.year, month, Number(dayText), hour, minute, zone)
    if (reset + DAY_MS <= since) reset = wallToUtc(today.year + 1, month, Number(dayText), hour, minute, zone)
    return new Date(reset).toISOString()
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

export function handoffPrompt(task: string, session: LimitedSession): string {
  const steps = session.recent.filter((line) => line.kind !== 'error').slice(-HANDOFF_STEPS)
  const lines = [
    task,
    '',
    'Продолжение: прошлая сессия по этой задаче упёрлась в лимит и остановлена, задачу доводишь ты.',
    `- Рабочая папка: ${session.workdir} — работай в ней, новый worktree не создавай.`,
  ]
  if (session.branch !== null) lines.push(`- Ветка: ${session.branch} — не меняй её.`)
  if (session.transcript !== null) {
    lines.push(`- Транскрипт прошлой сессии: ${session.transcript} — целиком не читай, ищи в нём grep, если чего-то не хватает.`)
  }
  lines.push('- Начни с git status, git log main..HEAD и описания задачи.')
  if (steps.length > 0) lines.push('', 'Последние шаги прошлой сессии:', ...steps.map((line) => `- ${line.text}`))
  return lines.join('\n') + '\n'
}

function wallDate(utc: number, zone: string): { year: number; month: number; day: number } {
  const parts = wallParts(utc, zone)
  return { year: parts.year, month: parts.month - 1, day: parts.day }
}

function wallToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const guess = Date.UTC(year, month, day, hour, minute)
  const first = guess - zoneOffset(guess, zone)
  return guess - zoneOffset(first, zone)
}

function zoneOffset(utc: number, zone: string): number {
  const parts = wallParts(utc, zone)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(utc / 1000) * 1000
}

function wallParts(utc: number, zone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const value = (type: string) => Number(format.formatToParts(new Date(utc)).find((part) => part.type === type)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}
