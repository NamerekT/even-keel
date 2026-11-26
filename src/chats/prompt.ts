import { splitUserMessage, USER_MESSAGE_HEAD } from '../chain/user-message.js'
import type { Language } from '../language.js'
import { fill } from '../sessions/prompt.js'
import type { FeedLine } from '../sessions/transcript.js'
import { cut } from './model.js'

/** What the machine knows of a chat's session (`MachineChats.past`): its id, transcript and recent lines. */
export interface ChatPast {
  sessionId: string
  transcript: string | null
  recent: FeedLine[]
}

/** How many of the old chat's last turns a new session gets, and how long each may be. */
export const RENEW_TURNS = 10
const TURN_CHARS = 600

export interface ChatTurn {
  from: 'user' | 'agent'
  text: string
}

/**
 * The old chat's last turns from its transcript, never from a model: the user's words and the agent's text, without the
 * tools. A message that itself carried an earlier chat on keeps only the user's words.
 */
export function turnsOf(recent: FeedLine[]): ChatTurn[] {
  const turns = recent.flatMap((line): ChatTurn[] => {
    if (line.kind === 'text') return line.text.trim() === '' ? [] : [{ from: 'agent', text: line.text }]
    if (line.kind !== 'prompt' && line.kind !== 'answer') return []
    const text = splitUserMessage(line.text)?.message ?? line.text
    return text.trim() === '' ? [] : [{ from: 'user', text }]
  })
  return turns.slice(-RENEW_TURNS).map((turn) => ({ ...turn, text: cut(turn.text.replace(/\s+/g, ' '), TURN_CHARS) }))
}

const TEXTS = {
  en: {
    lead: 'This chat goes on from an earlier chat of the project, whose session was stopped.',
    turns: "Its last turns, from its transcript (the user's words and your answers):",
    user: 'User',
    agent: 'You',
    transcript: (path: string) => fill`Its transcript: ${path} — do not read it whole; grep it if something is missing.`,
    stayed: (machine: string) => fill`Its transcript stayed on the machine "${machine}": there is no copy of it here.`,
  },
  ru: {
    lead: 'Этот чат продолжает прежний чат проекта, его сессия остановлена.',
    turns: 'Его последние реплики из транскрипта (слова пользователя и твои ответы):',
    user: 'Пользователь',
    agent: 'Ты',
    transcript: (path: string) => fill`Его транскрипт: ${path} — целиком не читай, ищи в нём grep, если чего-то не хватает.`,
    stayed: (machine: string) => fill`Его транскрипт остался на машине «${machine}»: копии здесь нет.`,
  },
} satisfies Record<Language, unknown>

/**
 * The first prompt of a chat that goes on from another in a new session (BTN-1232): the old chat's last turns and its
 * transcript, then the user's message under `USER_MESSAGE_HEAD`, last, so the page shows it apart (BTN-1281).
 * `stayedOn` — the name of the old chat's machine, whose transcript the new one could not get a copy of (BTN-1711).
 */
export function renewPrompt(message: string, past: ChatPast | null, language: Language, stayedOn?: string): string {
  const text = TEXTS[language]
  const lines = [text.lead]
  const turns = past === null ? [] : turnsOf(past.recent)
  if (turns.length > 0) lines.push('', text.turns, ...turns.map((turn) => fill`- ${turn.from === 'user' ? text.user : text.agent}: ${turn.text}`))
  if (past?.transcript != null) lines.push('', text.transcript(past.transcript))
  else if (stayedOn !== undefined) lines.push('', text.stayed(stayedOn))
  return `${lines.join('\n')}\n\n${USER_MESSAGE_HEAD[language]}\n\n${message.trimEnd()}\n`
}
