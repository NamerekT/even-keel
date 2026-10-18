import type { DatabaseSync } from 'node:sqlite'
import { inTransaction } from '../storage/database.js'
import type { Mail, MailEvent, MailFate } from './mail.js'

const KEEP_MS = 7 * 24 * 60 * 60_000
const SHOWN_DELIVERED = 3
/** How long a message is left to the hooks before an idle-looking session is judged: its status may lag the turn. */
const GRACE_MS = 10_000

/**
 * What becomes of a message that still waits: the hooks may yet take it from a working session; a session that ended
 * its turn without a question gets it by a resume, like an answer; one that asked, or is gone, gives it back to the chat.
 */
export function mailOutcome(postedAt: string, session: { midTurn: boolean; asking: boolean } | undefined, now: Date): 'wait' | 'resume' | 'return' {
  if (session?.midTurn === true || now.getTime() - Date.parse(postedAt) < GRACE_MS) return 'wait'
  return session === undefined || session.asking ? 'return' : 'resume'
}

interface Row {
  id: number
  task: string
  session_id: string
  text: string
  files: string
  posted_at: string
  fate: MailFate
  event: MailEvent | null
  settled_at: string | null
}

/**
 * The chat's messages to sessions in the middle of a turn, in the `mailbox` table: a hook of the `checkpoint` plugin
 * takes them on the session's next tool call or stop (BTN-181). Which sessions' hooks ask is known only since the start.
 */
export class Mailbox {
  private readonly heard = new Set<string>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  /** The session's hooks have asked for mail at least once since the service started. */
  listens(sessionId: string): boolean {
    return this.heard.has(sessionId)
  }

  post(task: string, sessionId: string, text: string, files: string[]): Mail {
    const at = this.now()
    this.db.prepare("DELETE FROM mailbox WHERE fate <> 'waiting' AND settled_at < ?").run(new Date(at.getTime() - KEEP_MS).toISOString())
    const { id } = this.db
      .prepare("INSERT INTO mailbox (task, session_id, text, files, posted_at, fate) VALUES (?, ?, ?, ?, ?, 'waiting') RETURNING id")
      .get(task, sessionId, text, JSON.stringify(files), at.toISOString()) as { id: number }
    return this.byId(id)!
  }

  /** The hook's call: what waits for the session, now delivered on `event`. */
  take(sessionId: string, event: MailEvent): Mail[] {
    this.heard.add(sessionId)
    return this.settle(this.rows('WHERE session_id = ? AND fate = ?', sessionId, 'waiting'), 'delivered', event)
  }

  waiting(): Mail[] {
    return this.rows('WHERE fate = ?', 'waiting')
  }

  /** Gives `fate` to those of `mails` that still wait and returns them. */
  settle(mails: Mail[], fate: Exclude<MailFate, 'waiting'>, event: MailEvent | null = null): Mail[] {
    const at = this.now().toISOString()
    const update = this.db.prepare("UPDATE mailbox SET fate = ?, event = ?, settled_at = ? WHERE id = ? AND fate = 'waiting'")
    const settled = inTransaction(this.db, () => mails.filter((mail) => Number(update.run(fate, event, at, mail.id).changes) > 0))
    return settled.map((mail) => ({ ...mail, fate, event, settledAt: at }))
  }

  /** The returned messages of the session leave the chat window: the user sent them again or let them go. */
  dismiss(sessionId: string): void {
    this.db.prepare("UPDATE mailbox SET fate = 'dismissed' WHERE session_id = ? AND fate = 'returned'").run(sessionId)
  }

  /** What the chat window shows: the waiting and returned messages and the last few delivered, oldest first. */
  of(sessionId: string): Mail[] {
    const all = this.rows("WHERE session_id = ? AND fate <> 'dismissed'", sessionId)
    const delivered = all.filter((mail) => mail.fate === 'delivered').slice(-SHOWN_DELIVERED)
    return all.filter((mail) => mail.fate !== 'delivered' || delivered.includes(mail))
  }

  private byId(id: number): Mail | undefined {
    return this.rows('WHERE id = ?', id)[0]
  }

  private rows(where: string, ...values: (string | number)[]): Mail[] {
    const rows = this.db.prepare(`SELECT * FROM mailbox ${where} ORDER BY id`).all(...values) as unknown as Row[]
    return rows.map((row) => ({
      id: row.id,
      task: row.task,
      sessionId: row.session_id,
      text: row.text,
      files: JSON.parse(row.files) as string[],
      postedAt: row.posted_at,
      fate: row.fate,
      event: row.event,
      settledAt: row.settled_at,
    }))
  }
}
