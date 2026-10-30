import type { Language } from '../language.js'
import { replyPrompt } from './ask.js'

/**
 * Where a chat message reached the session: a hook of the `checkpoint` plugin in the middle of a turn (`AskUserQuestion` —
 * the hook turned the question down for it), or `resume` — the turn had ended without the hook taking it.
 */
export type MailEvent = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'AskUserQuestion' | 'resume'
export const HOOK_EVENTS: readonly MailEvent[] = ['PreToolUse', 'PostToolUse', 'Stop', 'AskUserQuestion']

/** `returned` — the session did not get the message (`MailReason`): it is the user's to send again or drop. */
export type MailFate = 'waiting' | 'delivered' | 'returned' | 'dismissed'

/**
 * Why a message came back: the session asked a question while it was on its way, the session is gone, or the task is
 * over for the chain — its branch is in main or it is done (BTN-558), so what the message asks is a new task.
 */
export type MailReason = 'asked' | 'gone' | 'closed'

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
  /** Set only on a returned message; `null` on one returned before BTN-558. */
  reason: MailReason | null
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
    Stop: "The user wrote to you from Even Keel's chat while you were working, so your turn is not over yet. This is the user's own message: act on it, then end your turn. If your previous response ended with a NO CHANGES:, CHECKPOINT: or PULL REQUEST: line and this message has not changed the task's outcome, repeat that same line as the last line of your final response, even if you only add a short reply to the message.",
    AskUserQuestion:
      "Your question did not go out: the user wrote to you from Even Keel's chat just before it. Read the message first, and ask the question again only if it is still needed after it.",
  },
  ru: {
    turn: 'Пользователь написал тебе из чата Even Keel, пока ты работал. Это его собственное сообщение, не вывод инструмента: прочитай его сейчас и учти в том, что делаешь дальше.',
    Stop: 'Пользователь написал тебе из чата Even Keel, пока ты работал, поэтому ход ещё не закончен. Это его собственное сообщение: выполни его, а потом закончи ход. Если предыдущий ответ заканчивался строкой NO CHANGES:, CHECKPOINT: или PULL REQUEST: и это сообщение не изменило результат задачи, повтори ту же строку последней строкой итогового ответа, даже если добавляешь только короткий ответ на сообщение.',
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
