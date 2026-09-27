import { resetTimeOf } from '../limits/reset.js'
import type { FeedLine } from '../sessions/transcript.js'

export const WARM_CACHE_MS = 55 * 60_000
const HANDOFF_STEPS = 10

export const RESUME_PROMPT = 'Лимит сброшен — продолжай с того же места.'

export type RelayAction = 'resume' | 'relay'
export type RelayStep = 'wait' | RelayAction

export type HandoffReason = 'limit' | 'restart'

export interface HandoffSession {
  sessionId: string
  agentId: string
  cwd: string
  workdir: string
  branch: string | null
  transcript: string | null
  lastReplyAt: string | null
  recent: FeedLine[]
  lastMessage: string | null
}

export interface LimitedSession extends HandoffSession {
  limit: { at: string; text: string }
}

const HANDOFF_WHY: Record<HandoffReason, string> = {
  limit: 'Продолжение: прошлая сессия по этой задаче упёрлась в лимит и остановлена, задачу доводишь ты.',
  restart: 'Продолжение: прошлую сессию по этой задаче остановил пользователь — она задачу не довела, доводишь ты.',
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


export function handoffPrompt(task: string, session: HandoffSession, reason: HandoffReason = 'limit'): string {
  const steps = session.recent.filter((line) => line.kind !== 'error').slice(-HANDOFF_STEPS)
  const lines = [
    task,
    '',
    HANDOFF_WHY[reason],
    `- Рабочая папка: ${session.workdir} — работай в ней, новый worktree не создавай.`,
  ]
  if (session.branch !== null) lines.push(`- Ветка: ${session.branch} — не меняй её.`)
  if (session.transcript !== null) {
    lines.push(`- Транскрипт прошлой сессии: ${session.transcript} — целиком не читай, ищи в нём grep, если чего-то не хватает.`)
  }
  lines.push('- Начни с git status, git log main..HEAD и описания задачи.')
  if (steps.length > 0) lines.push('', 'Последние шаги прошлой сессии:', ...steps.map((line) => `- ${line.text}`))
  if (session.lastMessage !== null) lines.push('', 'Последнее сообщение прошлой сессии:', '', session.lastMessage)
  return lines.join('\n') + '\n'
}
