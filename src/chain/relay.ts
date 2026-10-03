import type { TaskPlace } from '../git/types.js'
import { resetTimeOf } from '../limits/reset.js'
import { fill } from '../sessions/prompt.js'
import type { FeedLine } from '../sessions/transcript.js'

export const WARM_CACHE_MS = 55 * 60_000
const HANDOFF_STEPS = 10

export const RESUME_PROMPT = 'Лимит сброшен — продолжай с того же места.'

export const CLEANUP_NOTE =
  '- Задачу закрывает слияние ветки в main основного чекаута. Worktree и ветку после этого не трогай и main не пушь — уборку сделает Батон.'

export function startPrompt(task: string, place: TaskPlace): string {
  const lines = [fill`${task}`, '', fill`- Worktree готов: ${place.path} — работай в нём, новый worktree не создавай.`]
  if (place.branch !== null) lines.push(fill`- Ветка: ${place.branch} — не меняй её.`)
  lines.push(CLEANUP_NOTE)
  return lines.join('\n') + '\n'
}

export type RelayAction = 'resume' | 'relay'
export type RelayStep = 'wait' | RelayAction

export type HandoffReason = 'limit' | 'restart' | 'checkpoint'

export interface HandoffSession {
  sessionId: string
  agentId: string
  account: string
  cwd: string
  workdir: string
  branch: string | null
  transcript: string | null
  lastReplyAt: string | null
  recent: FeedLine[]
  lastMessage: string | null
  checkpoint: string | null
}

export interface LimitedSession extends HandoffSession {
  limit: { at: string; text: string }
}

const HANDOFF_WHY: Record<HandoffReason, string> = {
  limit: 'Продолжение: прошлая сессия по этой задаче упёрлась в лимит и остановлена, задачу доводишь ты.',
  restart: 'Продолжение: прошлую сессию по этой задаче остановил пользователь — она задачу не довела, доводишь ты.',
  checkpoint:
    'Продолжение: прошлая сессия по этой задаче поставила контрольную точку, чтобы не тащить раздутый контекст дальше, и остановлена — задачу доводишь ты.',
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
  id: string | null
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
  const switched = hold.account !== null && account.id !== null && account.id !== hold.account
  const reset = hold.resetsAt !== null && now.getTime() >= Date.parse(hold.resetsAt)
  if (!switched && !reset) return 'wait'
  const warm =
    !switched &&
    hold.account !== null &&
    account.id === hold.account &&
    hold.lastReplyAt !== null &&
    now.getTime() - Date.parse(hold.lastReplyAt) < WARM_CACHE_MS
  return warm ? 'resume' : 'relay'
}


export function handoffPrompt(task: string, session: HandoffSession, reason: HandoffReason = 'limit'): string {
  const lines = [
    fill`${task}`,
    '',
    HANDOFF_WHY[reason],
    fill`- Рабочая папка: ${session.workdir} — работай в ней, новый worktree не создавай.`,
  ]
  if (session.branch !== null) lines.push(fill`- Ветка: ${session.branch} — не меняй её.`)
  lines.push(CLEANUP_NOTE)
  if (session.transcript !== null) {
    lines.push(fill`- Транскрипт прошлой сессии: ${session.transcript} — целиком не читай, ищи в нём grep, если чего-то не хватает.`)
  }
  if (session.checkpoint !== null) {
    lines.push(fill`- Записка о передаче: ${notePath(session.workdir, session.checkpoint)} — прочитай её первой: что сделано, что осталось, следующая команда.`)
  }
  lines.push('- Начни с git status, git log main..HEAD и описания задачи.')
  if (session.checkpoint !== null) return lines.join('\n') + '\n'
  const steps = session.recent.filter((line) => line.kind !== 'error').slice(-HANDOFF_STEPS)
  if (steps.length > 0) lines.push('', 'Последние шаги прошлой сессии:', ...steps.map((line) => fill`- ${line.text}`))
  if (session.lastMessage !== null) lines.push('', 'Последнее сообщение прошлой сессии:', '', fill`${session.lastMessage}`)
  return lines.join('\n') + '\n'
}

function notePath(workdir: string, note: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(note)) return note
  return fill`${workdir.replace(/[\\/]+$/, '')}/${note.replace(/^\.[\\/]/, '')}`
}
