import type { Queryable } from '../storage/database.js'
import type { Mail } from './mail.js'

/** Complete changed rows, with the cutoff used by the producer, not SQL supplied by a machine. */
export interface MailboxChange {
  mails: Mail[]
  before?: string
}

export async function saveMailboxChange(db: Queryable, change: MailboxChange): Promise<void> {
  if (change.before !== undefined) await db.query("delete from mailbox where fate <> 'waiting' and settled_at < $1", [change.before])
  for (const mail of change.mails) {
    await db.query(
      `insert into mailbox (id, task, session_id, text, files, posted_at, fate, event, reason, settled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (id) do update set fate = excluded.fate, event = excluded.event,
         reason = excluded.reason, settled_at = excluded.settled_at`,
      [mail.id, mail.task, mail.sessionId, mail.text, JSON.stringify(mail.files), mail.postedAt, mail.fate, mail.event, mail.reason, mail.settledAt],
    )
  }
}
