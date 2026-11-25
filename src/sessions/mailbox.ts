import { inTransaction, type Db, type Queryable, type Writes } from '../storage/database.js'
import type { Mail, MailEvent, MailFate, MailReason } from './mail.js'
import { saveMailboxChange, type MailboxChange } from './mailbox-store.js'

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
  reason: MailReason | null
  settled_at: string | null
}

/**
 * How a machine numbers its messages (BTN-1699): the number goes into the session's prompt, and a transcript shows each
 * number once, so it never comes again — not after a restart that brought nothing back, not after the old messages are
 * cut. `last` is the highest number the machine gave, `keep` stores a new one where a restart finds it. `parity` keeps
 * apart the two machines whose messages one session gets: the hub's own machine (0, even), whose mailbox a session
 * elsewhere's hooks ask, and that session's machine (1, odd), which writes into its inbox. Absent — 1, 2, 3, …
 */
export interface MailNumbers {
  last: number
  parity?: 0 | 1
  keep: (id: number) => void
}

/** The smallest number past `after` of the parity. */
function nextNumber(after: number, parity: 0 | 1 | undefined): number {
  const next = after + 1
  return parity === undefined || next % 2 === parity ? next : next + 1
}

/**
 * The chat's messages to sessions in the middle of a turn, in the `mailbox` table: a hook of the `agent-bridge` plugin
 * takes them on the session's next tool call or stop (BTN-181). Which sessions' hooks ask is known from the hooks, the
 * service's own starts and, after a restart, `expectWith`. The rows are kept in memory as well, read at the start: a message is settled once, by whoever comes first, without
 * waiting on the database; each change is written behind (`Writes`).
 */
export class Mailbox {
  private readonly heard = new Set<string>()
  private readonly claimed = new Set<number>()
  private started: (sessionId: string) => boolean = () => false
  private persist: (change: MailboxChange) => Promise<void>

  private constructor(
    private readonly writes: Writes,
    private mails: Mail[],
    private readonly now: () => Date,
    persist: (change: MailboxChange) => Promise<void>,
    private readonly numbers: MailNumbers = { last: 0, keep: () => {} },
  ) {
    this.persist = persist
  }

  /** The linked machine persists through its outbox instead of opening the hub's database. */
  persistWith(persist: (change: MailboxChange) => Promise<void>): void {
    this.persist = persist
  }

  static async open(db: Db, writes: Writes, now: () => Date): Promise<Mailbox> {
    return new Mailbox(writes, await loadMail(db), now, (change) => inTransaction(db, (tx) => saveMailboxChange(tx, change, null)))
  }

  /**
   * A machine's mailbox, which never opens the hub's database: its messages come with `restore` (`records.restore`,
   * `docs/machines.md`), its changes go out through `persistWith`.
   */
  static detached(writes: Writes, now: () => Date, numbers?: MailNumbers): Mailbox {
    return new Mailbox(writes, [], now, () => Promise.reject(new Error('the mailbox has no store yet')), numbers)
  }

  /**
   * The messages the hub keeps, records replayed from the outbox included: at the start of the hub's own machine, at
   * each connection of a machine elsewhere (BTN-1699). A message this mailbox already has stays as it is here: one
   * posted or settled since may not have reached the hub yet.
   */
  restore(mails: Mail[]): void {
    const here = new Set(this.mails.map((mail) => mail.id))
    this.mails = [...mails.filter((mail) => !here.has(mail.id)).map((mail) => ({ ...mail })), ...this.mails]
  }

  /**
   * After a restart (BTN-1506): `started` tells a session the service started or resumed with the hooks that ask for
   * mail, from what outlives the restart. The service keeps no mark of its own for that.
   */
  expectWith(started: (sessionId: string) => boolean): void {
    this.started = started
  }

  /** The session's hooks have asked for mail at least once since the service started, or it `expect`s them to. */
  listens(sessionId: string): boolean {
    if (this.heard.has(sessionId)) return true
    if (!this.started(sessionId)) return false
    this.heard.add(sessionId)
    return true
  }

  /**
   * The service has just started or resumed the session with the hooks that ask for mail (BTN-1430): it listens from
   * now, before they first ask. Mail its hooks never take settles at the end of the turn like any other.
   */
  expect(sessionId: string): void {
    this.heard.add(sessionId)
  }

  post(task: string, sessionId: string, text: string, files: string[]): Mail {
    return this.add(task, sessionId, text, files, null)
  }

  /**
   * An answer the chat sent to a waiting session that never reached it (BTN-1331): it shows in the chat as returned,
   * the user's to send again or drop, like a message the mailbox gave back.
   */
  giveBack(task: string, sessionId: string, text: string, files: string[], reason: MailReason): Mail {
    return this.add(task, sessionId, text, files, reason)
  }

  private add(task: string, sessionId: string, text: string, files: string[], returned: MailReason | null): Mail {
    const at = this.now()
    const before = new Date(at.getTime() - KEEP_MS).toISOString()
    this.mails = this.mails.filter((mail) => mail.fate === 'waiting' || mail.settledAt === null || mail.settledAt >= before)
    const id = nextNumber(Math.max(this.numbers.last, ...this.mails.map((each) => each.id)), this.numbers.parity)
    this.numbers.last = id
    this.numbers.keep(id)
    const postedAt = at.toISOString()
    const mail: Mail = returned === null
      ? { id, task, sessionId, text, files, postedAt, fate: 'waiting', event: null, reason: null, settledAt: null }
      : { id, task, sessionId, text, files, postedAt, fate: 'returned', event: null, reason: returned, settledAt: postedAt }
    this.mails.push(mail)
    this.write({ mails: [mail], before })
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

  /** Gives `fate` to those of `mails` that still wait and returns them; a returned one keeps `reason`. */
  settle(mails: Mail[], fate: Exclude<MailFate, 'waiting'>, event: MailEvent | null = null, reason: MailReason | null = null): Mail[] {
    const settledAt = this.now().toISOString()
    const ids = new Set(mails.map((mail) => mail.id))
    const settled = this.mails.filter((mail) => ids.has(mail.id) && mail.fate === 'waiting')
    if (settled.length === 0) return []
    for (const mail of settled) {
      this.claimed.delete(mail.id)
      Object.assign(mail, { fate, event, reason, settledAt })
    }
    this.write({ mails: settled })
    return settled.map((mail) => ({ ...mail }))
  }

  /** The returned messages of the session leave the chat window: the user sent them again or let them go. */
  dismiss(sessionId: string): void {
    const returned = this.mails.filter((mail) => mail.sessionId === sessionId && mail.fate === 'returned')
    if (returned.length === 0) return
    for (const mail of returned) mail.fate = 'dismissed'
    this.write({ mails: returned })
  }

  /** Every message the session got that the mailbox still keeps, oldest first: for a transcript that lacks them. */
  delivered(sessionId: string): Mail[] {
    return this.mails.filter((mail) => mail.sessionId === sessionId && mail.fate === 'delivered').map((mail) => ({ ...mail }))
  }

  /** What the chat window shows: the waiting and returned messages and the last few delivered, oldest first. */
  of(sessionId: string): Mail[] {
    const all = this.mails.filter((mail) => mail.sessionId === sessionId && mail.fate !== 'dismissed')
    const delivered = all.filter((mail) => mail.fate === 'delivered').slice(-SHOWN_DELIVERED)
    return all.filter((mail) => mail.fate !== 'delivered' || delivered.includes(mail)).map((mail) => ({ ...mail }))
  }

  private write(change: MailboxChange): void {
    this.writes.add('a mailbox change', this.persist(structuredClone(change)))
  }
}

/** The messages the `mailbox` table keeps, oldest first: those of `machine`, or all of them. */
export async function loadMail(db: Queryable, machine?: string): Promise<Mail[]> {
  const { rows } = machine === undefined
    ? await db.query<Row>('select * from mailbox order by id')
    : await db.query<Row>('select * from mailbox where machine_id = $1 order by id', [machine])
  return rows.map(mailOf)
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
    reason: row.reason,
    settledAt: row.settled_at,
  }
}
