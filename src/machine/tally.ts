import type { PGlite } from '@electric-sql/pglite'
import type { AccountHome } from '../account/homes.js'
import type { FileState } from '../../tally/src/load.js'
import { shipToHub, type MarkStore, type SendRows, type ShipResult } from '../../tally/src/ship.js'

// The Tally collector of a machine elsewhere (BTN-1280, `docs/tally.md`, "Machines elsewhere"): it reads the machine's
// transcripts and sends the rows to the hub, which writes them; the read marks stay here, in the machine's database.

/** As the hub's collector: the first pass once the link is up, then every five minutes. */
export const MACHINE_TALLY_FIRST_MS = 15_000
export const MACHINE_TALLY_EVERY_MS = 5 * 60_000

/** The marks in the machine's `tally_files`. */
export function machineMarks(db: PGlite): MarkStore {
  return {
    marks: async () => {
      const { rows } = await db.query<{ path: string; account: string; read_to: string | number; size: string | number; mtime: string; ino: string; head: string; head_len: number }>(
        'select path, account, read_to, size, mtime, ino, head, head_len from tally_files',
      )
      return new Map(rows.map((row): [string, FileState] => [
        row.path,
        { path: row.path, account: row.account, offset: Number(row.read_to), size: Number(row.size), mtime: row.mtime, ino: row.ino, head: row.head, headLen: row.head_len },
      ]))
    },
    mark: async (file) => {
      await db.query(
        `insert into tally_files (path, account, read_to, size, mtime, ino, head, head_len) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (path) do update set account = excluded.account, read_to = excluded.read_to, size = excluded.size,
           mtime = excluded.mtime, ino = excluded.ino, head = excluded.head, head_len = excluded.head_len`,
        [file.path, file.account, file.offset, file.size, file.mtime, file.ino, file.head, file.headLen],
      )
    },
    forgetExcept: async (paths) => {
      const result = await db.query('delete from tally_files where not (path = any($1::text[]))', [paths])
      return result.affectedRows ?? 0
    },
  }
}

export interface MachineTallyOptions {
  homes: () => AccountHome[]
  marks: MarkStore
  send: SendRows
  log: (line: string) => void
  firstMs?: number
  everyMs?: number
}

/** One line for the log; `undefined` — nothing worth one. */
export function shipLine(result: ShipResult): string | undefined {
  if (result.state === 'away') return result.files > 0 ? `tally: ${result.lines} lines of ${result.files} files sent; the hub takes no more now` : undefined
  if (result.files === 0 && result.failed === 0) return undefined
  return `tally: ${result.lines} lines of ${result.files} files sent to the hub${result.failed > 0 ? `, ${result.failed} failed` : ''}`
}

/** Starts the passes; one at a time, the next an interval after one ends. */
export function startMachineTally(options: MachineTallyOptions): { stop(): void } {
  const { log } = options
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  const pass = async () => {
    try {
      const line = shipLine(await shipToHub(options.homes(), options.marks, options.send, log))
      if (line !== undefined) log(line)
    } catch (error) {
      log(`tally: the pass failed: ${(error as Error).message}`)
    }
    schedule(options.everyMs ?? MACHINE_TALLY_EVERY_MS)
  }
  const schedule = (delayMs: number) => {
    if (stopped) return
    timer = setTimeout(() => void pass(), delayMs)
    timer.unref()
  }
  schedule(options.firstMs ?? MACHINE_TALLY_FIRST_MS)
  return {
    stop: () => {
      stopped = true
      clearTimeout(timer)
    },
  }
}
