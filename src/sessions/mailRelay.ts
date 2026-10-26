import type { Language } from '../language.js'
import { mailMessage, mailPrompt, type Mail, type MailEvent } from './mail.js'
import { mailOutcome, type Mailbox } from './mailbox.js'

/** What the service gives the mailbox to settle messages and answer the hooks. */
export interface MailRelay {
  mailbox: Mailbox
  /** The task's live session: its id, whether it is in the middle of a turn, whether it waits on a question. */
  live: (task: string) => { sessionId: string; midTurn: boolean; asking: boolean } | undefined
  /** Resolves to whether the queued reply reached the transport; may throw when the session cannot be answered. */
  resume: (task: string, sessionId: string, prompt: string) => Promise<boolean>
  language: () => Language
  changed: () => void
  log: (line: string) => void
  now: () => Date
}

/**
 * The race of a message and the end of a turn: what still waits for a session that is no longer in a turn goes to it by
 * a resume, or back to the chat when the session asked a question meanwhile or is gone (BTN-181).
 */
export async function settleMail(relay: MailRelay): Promise<void> {
  const deliveries: Promise<void>[] = []
  const bySession = new Map<string, Mail[]>()
  for (const mail of relay.mailbox.waiting()) bySession.set(mail.sessionId, [...(bySession.get(mail.sessionId) ?? []), mail])
  for (const [sessionId, mails] of bySession) {
    const task = mails[0]!.task
    const live = relay.live(task)
    const own = live?.sessionId === sessionId ? live : undefined
    const outcome = mailOutcome(mails[0]!.postedAt, own, relay.now())
    if (outcome === 'wait') continue
    if (outcome === 'resume') {
      deliveries.push(resumed(relay, task, sessionId, mails))
      continue
    }
    relay.mailbox.settle(mails, 'returned')
    relay.log(`chain: ${task}: ${mails.length} message(s) from the page went back to the chat: the session ${sessionId} ${own === undefined ? 'is gone' : 'asked a question'} before its hooks took them`)
    relay.changed()
  }
  await Promise.all(deliveries)
}

async function resumed(relay: MailRelay, task: string, sessionId: string, waiting: Mail[]): Promise<void> {
  const mails = relay.mailbox.claim(waiting)
  if (mails.length === 0) return
  const prompt = mails.map((mail) => mailPrompt(mail, relay.language())).join('\n')
  let delivered = false
  try {
    delivered = await relay.resume(task, sessionId, prompt)
  } catch (error) {
    relay.log(`chain: ${task}: the session ${sessionId} ended its turn before its hooks took the page's message and cannot be resumed: ${error instanceof Error ? error.message : String(error)}`)
  }
  relay.mailbox.settle(mails, delivered ? 'delivered' : 'returned', delivered ? 'resume' : null)
  relay.log(delivered
    ? `chain: ${task}: the session ${sessionId} ended its turn before its hooks took ${mails.length} message(s) from the page; they went by a resume`
    : `chain: ${task}: ${mails.length} message(s) from the page went back to the chat: the resume of the session ${sessionId} did not deliver them`)
  relay.changed()
}

/** The hook's call: the text for what waits for the session, now delivered on `event`, or `null` when nothing waits. */
export function mailFor(relay: MailRelay, sessionId: string, event: MailEvent): string | null {
  const taken = relay.mailbox.take(sessionId, event)
  if (taken.length === 0) return null
  relay.log(`chain: ${taken[0]!.task}: the hook of the session ${sessionId} took ${taken.length} message(s) from the page on ${event}`)
  relay.changed()
  return mailMessage(taken, event, relay.language())
}
