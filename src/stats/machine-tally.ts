import { TallyDb } from '../../tally/src/db.js'
import { isMachineRows } from '../../tally/src/machine-rows.js'
import type { TallyAnswer } from '../link/protocol.js'
import type { ReaderSettings } from './model.js'
import { TALLY_SCHEMA_VERSION } from './tally-schema.js'

export interface MachineTallyOptions {
  /** The database the hub collects into, read at each post: the service is made anew when stats are switched. */
  writer: () => Promise<ReaderSettings | null>
  log: (line: string) => void
}

/**
 * The hub's end of a machine's Tally rows (BTN-1280, `docs/tally.md`, "Machines elsewhere"): written one post at a
 * time, outside the collector's lock, since the rows go by their keys. Not taken while the hub collects nothing or
 * its database is of another schema than this build's: the hub's own run migrates it first.
 */
export class MachineTally {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: MachineTallyOptions) {}

  take(machine: string, rows: unknown): Promise<TallyAnswer> {
    const next = this.queue.then(() => this.write(machine, rows))
    this.queue = next.catch(() => {})
    return next
  }

  private async write(machine: string, rows: unknown): Promise<TallyAnswer> {
    const { log } = this.options
    if (!isMachineRows(rows)) {
      log(`tally: machine ${machine} sent rows of another shape; not written`)
      return { taken: false }
    }
    const settings = await this.options.writer()
    if (settings === null) return { taken: false }
    let db: TallyDb | undefined
    try {
      db = await TallyDb.connect(settings)
      const version = await db.version()
      if (version !== TALLY_SCHEMA_VERSION) return { taken: false }
      await db.writeMachine(machine, rows)
      return { taken: true }
    } catch (error) {
      log(`tally: the rows of machine ${machine} were not written: ${(error as Error).message}`)
      return { taken: false }
    } finally {
      await db?.close().catch(() => {})
    }
  }
}
