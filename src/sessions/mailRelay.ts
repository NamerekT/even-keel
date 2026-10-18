import type { Language } from '../language.js'
import { mailMessage, mailPrompt, type Mail, type MailEvent } from './mail.js'
import { mailOutcome, type Mailbox } from './mailbox.js'

/** What the service gives the mailbox to settle messages and answer the hooks. */
export interface MailRelay {
  mailbox: Mailbox
  /** The task's live session: its id, whether it is in the middle of a turn, whether it waits on a question. */
  live: (task: string) => { sessionId: string; midTurn: boolean; asking: boolean } | undefined
  /** Resumes the session with the prompt, like an answer; throws, having done nothing, when it may not be answered now. */
  resume: (task: string, sessionId: string, prompt: string) => void
  language: () => Language
  changed: () => void
  log: (line: string) => void
  now: () => Date
}

/**
 * The race of a message and the end of a turn: what still waits for a session that is no longer in a turn goes to it by
 * a resume, or back to the chat when the session asked a question meanwhile or is gone (BTN-181).
 */
export function settleMail(relay: MailRelay): void {
  const bySession = new Map<string, Mail[]>()
  for (const mail of relay.mailbox.waiting()) bySession.set(mail.sessionId, [...(bySession.get(mail.sessionId) ?? []), mail])
  for (const [sessionId, mails] of bySession) {
    const task = mails[0]!.task
    const live = relay.live(task)
    const own = live?.sessionId === sessionId ? live : undefined
    const outcome = mailOutcome(mails[0]!.postedAt, own, relay.now())
    if (outcome === 'wait') continue
    if (outcome === 'resume' && resumed(relay, task, sessionId, mails)) continue
    relay.mailbox.settle(mails, 'returned')
    relay.log(`chain: ${task}: ${mails.length} message(s) from the page went back to the chat: the session ${sessionId} ${own === undefined ? 'is gone' : 'asked a question'} before its hooks took them`)
    relay.changed()
  }
}

function resumed(relay: MailRelay, task: string, sessionId: string, mails: Mail[]): boolean {
  const prompt = mails.map((mail) => mailPrompt(mail, relay.language())).join('\n')
  try {
    relay.resume(task, sessionId, prompt)
  } catch (error) {
    relay.log(`chain: ${task}: the session ${sessionId} ended its turn before its hooks took the page's message and cannot be resumed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  relay.mailbox.settle(mails, 'delivered', 'resume')
  relay.log(`chain: ${task}: the session ${sessionId} ended its turn before its hooks took ${mails.length} message(s) from the page; they go by a resume`)
  relay.changed()
  return true
}

/** The hook's call: the text for what waits for the session, now delivered on `event`, or `null` when nothing waits. */
export function mailFor(relay: MailRelay, sessionId: string, event: MailEvent): string | null {
  const taken = relay.mailbox.take(sessionId, event)
  if (taken.length === 0) return null
  relay.log(`chain: ${taken[0]!.task}: the hook of the session ${sessionId} took ${taken.length} message(s) from the page on ${event}`)
  relay.changed()
  return mailMessage(taken, event, relay.language())
}
