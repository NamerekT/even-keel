import type { LaunchEntry } from '../chain/dispatcher.js'
import { appendLaunch } from '../chain/store.js'
import type { MachineEvent } from '../link/protocol.js'
import { saveMailboxChange, type MailboxChange } from '../sessions/mailbox-store.js'
import { saveSessionWindows } from '../storage/context-windows.js'
import { inTransaction, type Db } from '../storage/database.js'

export const LAUNCH_EVENT = 'launch.record'
export const WINDOWS_EVENT = 'session.windows'
export const MAILBOX_EVENT = 'chat.mailbox'

export function isRecordEvent(type: string): boolean {
  return type === LAUNCH_EVENT || type === WINDOWS_EVENT || type === MAILBOX_EVENT
}

/**
 * The machine's durable records go to its outbox; only the hub owns their tables. The machine keeps its own launch
 * journal in memory: what the hub handed it at the start (`restore`) and every launch since.
 */
export class MachineRecords {
  constructor(
    private readonly emit: (type: string, payload: unknown) => Promise<unknown>,
    readonly journal: LaunchEntry[] = [],
  ) {}

  async launch(entry: LaunchEntry): Promise<void> {
    this.journal.push(entry)
    await this.emit(LAUNCH_EVENT, entry)
  }

  /** The journal the hub keeps, before the machine's own launches since: those are already in it once taken. */
  restore(entries: LaunchEntry[]): void {
    const own = this.journal.filter((entry) => !entries.some((kept) => kept.sessionId === entry.sessionId && kept.at === entry.at))
    this.journal.splice(0, this.journal.length, ...entries, ...own)
  }

  async windows(windows: [string, number][], at: number): Promise<void> {
    await this.emit(WINDOWS_EVENT, { windows, at })
  }

  async mailbox(change: MailboxChange): Promise<void> {
    await this.emit(MAILBOX_EVENT, change)
  }
}

/**
 * A record and the link's receipt commit together. A crash after this transaction but before the HTTP answer (or
 * HubEnd's redundant eventTaken) cannot append the journal twice. No write-behind belongs inside this handler.
 */
export function saveMachineRecord(db: Db, machine: string, event: MachineEvent): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ last_event: string }>('select last_event from machines where id = $1 for update', [machine])
    if (rows[0] === undefined) throw new Error(`machine: no machine ${machine}`)
    if (Number(rows[0].last_event) >= event.seq) return false
    if (event.type === LAUNCH_EVENT) await appendLaunch(tx, event.payload as LaunchEntry)
    else if (event.type === WINDOWS_EVENT) {
      const { windows, at } = event.payload as { windows: [string, number][]; at: number }
      await saveSessionWindows(tx, windows, at)
    } else if (event.type === MAILBOX_EVENT) await saveMailboxChange(tx, event.payload as MailboxChange)
    else throw new Error(`machine: unknown record ${event.type}`)
    await tx.query('update machines set last_event = $2 where id = $1', [machine, event.seq])
    return true
  })
}
