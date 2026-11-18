import type { Queryable } from '../storage/database.js'
import type { Mail } from './mail.js'

/** Complete changed rows, with the cutoff used by the producer, not SQL supplied by a machine. */
export interface MailboxChange {
  mails: Mail[]
  before?: string
}

/**
 * The change of `machine`'s mailbox; `null` — a mailbox on the hub's own database, with no machine. The cutoff takes only
 * that machine's old settled rows and those kept before rows knew their machine. A row's fate only moves forward
 * (waiting → delivered or returned, returned → dismissed): a late or repeated change never brings a settled message back.
 */
export async function saveMailboxChange(db: Queryable, change: MailboxChange, machine: string | null): Promise<void> {
  if (change.before !== undefined) {
    await db.query(
      "delete from mailbox where fate <> 'waiting' and settled_at < $1 and (machine_id = $2 or machine_id is null)",
      [change.before, machine],
    )
  }
  for (const mail of change.mails) {
    await db.query(
      `insert into mailbox (id, task, session_id, text, files, posted_at, fate, event, reason, settled_at, machine_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set fate = excluded.fate, event = excluded.event,
         reason = excluded.reason, settled_at = excluded.settled_at
       where mailbox.fate = 'waiting' or (mailbox.fate = 'returned' and excluded.fate = 'dismissed')`,
      [mail.id, mail.task, mail.sessionId, mail.text, JSON.stringify(mail.files), mail.postedAt, mail.fate, mail.event, mail.reason, mail.settledAt, machine],
    )
  }
}
