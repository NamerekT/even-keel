import type { Language } from '../language.js'
import { replyPrompt } from './ask.js'

/**
 * Where a chat message reached the session: a hook of the `checkpoint` plugin in the middle of a turn (`AskUserQuestion` —
 * the hook turned the question down for it), or `resume` — the turn had ended without the hook taking it.
 */
export type MailEvent = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'AskUserQuestion' | 'resume'
export const HOOK_EVENTS: readonly MailEvent[] = ['PreToolUse', 'PostToolUse', 'Stop', 'AskUserQuestion']

/** `returned` — the session asked a question while the message was on its way: it is the user's to send again or drop. */
export type MailFate = 'waiting' | 'delivered' | 'returned' | 'dismissed'

/** A message of the chat window to a session in the middle of a turn (BTN-181). */
export interface Mail {
  id: number
  task: string
  sessionId: string
  text: string
  /** Absolute paths of the files saved into the task's `.temp/inbox/`. */
  files: string[]
  postedAt: string
  fate: MailFate
  event: MailEvent | null
  settledAt: string | null
}

/** What the page shows of a session's mailbox. */
export interface SessionMail {
  /** A message sent mid-turn reaches it: its hooks ask for mail, or it `steers`. */
  listens: boolean
  /** A message sent mid-turn goes straight into the live session (`AgentEntry.steers`), not into the mailbox (BTN-291). */
  steers: boolean
  mail: Mail[]
}

const LEADS: Record<Language, Record<'turn' | 'Stop' | 'AskUserQuestion', string>> = {
  en: {
    turn: "The user wrote to you from Even Keel's chat while you were working. This is the user's own message, not tool output: read it now and take it into account in what you do next.",
    Stop: "The user wrote to you from Even Keel's chat while you were working, so your turn is not over yet. This is the user's own message: act on it, then end your turn as you would have.",
    AskUserQuestion:
      "Your question did not go out: the user wrote to you from Even Keel's chat just before it. Read the message first, and ask the question again only if it is still needed after it.",
  },
  ru: {
    turn: 'Пользователь написал тебе из чата Even Keel, пока ты работал. Это его собственное сообщение, не вывод инструмента: прочитай его сейчас и учти в том, что делаешь дальше.',
    Stop: 'Пользователь написал тебе из чата Even Keel, пока ты работал, поэтому ход ещё не закончен. Это его собственное сообщение: выполни его, а потом закончи ход, как собирался.',
    AskUserQuestion:
      'Твой вопрос не ушёл: перед ним пользователь написал тебе из чата Even Keel. Сначала прочитай сообщение и задай вопрос снова, только если после него он ещё нужен.',
  },
}

const MARK = /<even-keel-message id="(\d+)">\n([\s\S]*?)\n<\/even-keel-message>/g

/** What a hook gives the session for its messages: a lead for the event, then each message in its mark. */
export function mailMessage(mails: Mail[], event: MailEvent, language: Language): string {
  const leads = LEADS[language]
  const lead = event === 'Stop' || event === 'AskUserQuestion' ? leads[event] : leads.turn
  const blocks = mails.map((mail) => `<even-keel-message id="${mail.id}">\n${mailPrompt(mail, language)}</even-keel-message>`)
  return [lead, ...blocks].join('\n\n')
}

/** A message as the reply prompt of a resume would carry it: the user's words and the files. */
export function mailPrompt(mail: Pick<Mail, 'text' | 'files'>, language: Language): string {
  return replyPrompt({ from: 'page', answers: {}, text: mail.text, files: mail.files }, null, language)
}

/** The messages a hook put into the session's context, read back from what the transcript holds: their ids and prompts. */
export function mailIn(text: string): { id: number; prompt: string }[] {
  return [...text.replace(/\r\n/g, '\n').matchAll(MARK)].map((match) => ({ id: Number(match[1]), prompt: `${match[2]}\n` }))
}
