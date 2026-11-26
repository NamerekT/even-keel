import { Writes } from '../storage/database.js'
import { Mailbox } from './mailbox.js'

/**
 * A mailbox that keeps its messages in memory only, for a test that never reads them back from the store: a PGlite
 * clone per mailbox costs about a second, several under the load of a full `npm test`, enough for a test of two to
 * run past vitest's 5 s timeout (BTN-1743).
 */
export function memoryMailbox(now: () => Date): Mailbox {
  const mailbox = Mailbox.detached(new Writes(() => {}), now)
  mailbox.persistWith(async () => {})
  return mailbox
}
