import type { Db, Writes } from '../storage/database.js'
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
 * The rows are kept in memory as well, read at the start: a message is settled once, by whoever comes first, without
 * waiting on the database; each change is written behind (`Writes`).
 */
export class Mailbox {
  private readonly heard = new Set<string>()
  private readonly claimed = new Set<number>()

  private constructor(
    private readonly db: Db,
    private readonly writes: Writes,
    private mails: Mail[],
    private readonly now: () => Date,
  ) {}

  static async open(db: Db, writes: Writes, now: () => Date): Promise<Mailbox> {
    const { rows } = await db.query<Row>('select * from mailbox order by id')
    return new Mailbox(db, writes, rows.map(mailOf), now)
  }

  /** The session's hooks have asked for mail at least once since the service started. */
  listens(sessionId: string): boolean {
    return this.heard.has(sessionId)
  }

  post(task: string, sessionId: string, text: string, files: string[]): Mail {
    const at = this.now()
    const before = new Date(at.getTime() - KEEP_MS).toISOString()
    this.mails = this.mails.filter((mail) => mail.fate === 'waiting' || mail.settledAt === null || mail.settledAt >= before)
    const id = Math.max(0, ...this.mails.map((each) => each.id)) + 1
    const mail: Mail = { id, task, sessionId, text, files, postedAt: at.toISOString(), fate: 'waiting', event: null, settledAt: null }
    this.mails.push(mail)
    this.write("delete from mailbox where fate <> 'waiting' and settled_at < $1", [before])
    this.write("insert into mailbox (id, task, session_id, text, files, posted_at, fate) values ($1, $2, $3, $4, $5, $6, 'waiting')", [
      id,
      task,
      sessionId,
      text,
      JSON.stringify(files),
      mail.postedAt,
    ])
    return { ...mail }
  }

  /** Reserves the hook's mail until its HTTP response finishes; stored rows still wait. */
  take(sessionId: string): Mail[] {
    this.heard.add(sessionId)
    return this.claim(this.waiting().filter((mail) => mail.sessionId === sessionId))
  }

  waiting(): Mail[] {
    return this.mails.filter((mail) => mail.fate === 'waiting' && !this.claimed.has(mail.id)).map((mail) => ({ ...mail }))
  }

  /** Holds waiting mail for a hook or queued resume, so neither can deliver it a second time. Not persisted. */
  claim(mails: Mail[]): Mail[] {
    const ids = new Set(mails.map((mail) => mail.id))
    const claimed = this.waiting().filter((mail) => ids.has(mail.id))
    for (const mail of claimed) this.claimed.add(mail.id)
    return claimed
  }

  /** A failed hook response leaves its messages available for the next hook or resume. */
  release(mails: Mail[]): void {
    for (const mail of mails) this.claimed.delete(mail.id)
  }

  /** Gives `fate` to those of `mails` that still wait and returns them. */
  settle(mails: Mail[], fate: Exclude<MailFate, 'waiting'>, event: MailEvent | null = null): Mail[] {
    const settledAt = this.now().toISOString()
    const ids = new Set(mails.map((mail) => mail.id))
    const settled = this.mails.filter((mail) => ids.has(mail.id) && mail.fate === 'waiting')
    if (settled.length === 0) return []
    for (const mail of settled) {
      this.claimed.delete(mail.id)
      Object.assign(mail, { fate, event, settledAt })
    }
    this.write("update mailbox set fate = $1, event = $2, settled_at = $3 where id = any($4) and fate = 'waiting'", [
      fate,
      event,
      settledAt,
      settled.map((mail) => mail.id),
    ])
    return settled.map((mail) => ({ ...mail }))
  }

  /** The returned messages of the session leave the chat window: the user sent them again or let them go. */
  dismiss(sessionId: string): void {
    const returned = this.mails.filter((mail) => mail.sessionId === sessionId && mail.fate === 'returned')
    if (returned.length === 0) return
    for (const mail of returned) mail.fate = 'dismissed'
    this.write("update mailbox set fate = 'dismissed' where session_id = $1 and fate = 'returned'", [sessionId])
  }

  /** What the chat window shows: the waiting and returned messages and the last few delivered, oldest first. */
  of(sessionId: string): Mail[] {
    const all = this.mails.filter((mail) => mail.sessionId === sessionId && mail.fate !== 'dismissed')
    const delivered = all.filter((mail) => mail.fate === 'delivered').slice(-SHOWN_DELIVERED)
    return all.filter((mail) => mail.fate !== 'delivered' || delivered.includes(mail)).map((mail) => ({ ...mail }))
  }

  private write(sql: string, params: unknown[]): void {
    this.writes.add('a mailbox change', this.db.query(sql, params))
  }
}

function mailOf(row: Row): Mail {
  return {
    id: row.id,
    task: row.task,
    sessionId: row.session_id,
    text: row.text,
    files: JSON.parse(row.files) as string[],
    postedAt: row.posted_at,
    fate: row.fate,
    event: row.event,
    settledAt: row.settled_at,
  }
}
