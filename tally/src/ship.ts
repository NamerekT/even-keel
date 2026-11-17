import type { AccountHome } from '../../src/account/homes.js'
import { copilotSources, loadCopilot } from './copilot.js'
import { loadFile, loadRollout, type FileState, type Source, type Store } from './load.js'
import { noRows, rowsOf, type MachineRows } from './machine-rows.js'
import { loadOpenCode, openCodeSources } from './opencode.js'
import { rolloutFiles, transcriptFiles } from './scan.js'

// The collector of a machine elsewhere (BTN-1280, `docs/tally.md`, "Machines elsewhere"): it reads its own
// transcripts as the hub's collector does and sends the rows to the hub over its link; the hub writes them.

/** A chunk of a transcript read at once: small, as the machine parses on its service's own thread. */
export const SHIP_CHUNK_BYTES = 1024 * 1024
/** One post to the hub at most, well under the link's body limit: a Codex rollout or an OpenCode database is one batch. */
export const SHIP_POST_BYTES = 2 * 1024 * 1024

/** The machine's read marks: kept on the machine, moved only once the hub took the rows read up to them. */
export interface MarkStore {
  marks(): Promise<Map<string, FileState>>
  mark(file: FileState): Promise<void>
  /** Drops the marks of every other path; the number dropped. */
  forgetExcept(paths: string[]): Promise<number>
}

/** `true` — the hub wrote the rows; `false` — it did not take them now (no link, Tally off there, a failed write). */
export type SendRows = (rows: MachineRows) => Promise<boolean>

export type ShipResult =
  | { state: 'done'; files: number; lines: number; failed: number; forgotten: number }
  | { state: 'away'; files: number; lines: number }

class HubAway extends Error {}

/** One pass over the machine's account folders. It stops at the first post the hub does not take: the rest waits for the next. */
export async function shipToHub(homes: AccountHome[], marks: MarkStore, send: SendRows, log: (line: string) => void, chunkBytes = SHIP_CHUNK_BYTES): Promise<ShipResult> {
  const store: Store = {
    files: () => marks.marks(),
    write: async (batch, file) => {
      for (const part of slices(rowsOf(batch), SHIP_POST_BYTES)) {
        if (!(await send(part))) throw new HubAway()
      }
      await marks.mark(file)
    },
  }
  const stored = await marks.marks()
  // No launches and no rule context: the hub applies its launch log to the sessions, and rule rows stay off the wire.
  const context = (source: Source) => ({ account: source.account, launches: new Map() })
  const sources = await transcriptFiles(homes)
  const rollouts = await rolloutFiles(homes)
  const openCode = openCodeSources(homes)
  const copilot = await copilotSources(homes)
  const loads: [string, () => Promise<number>][] = [
    ...sources.map((source) => [source.path, () => loadFile(source, stored.get(source.path), store, context(source), chunkBytes)] as [string, () => Promise<number>]),
    ...rollouts.map((source) => [source.path, () => loadRollout(source, stored.get(source.path), store, context(source))] as [string, () => Promise<number>]),
    ...openCode.map((source) => [source.path, () => loadOpenCode(source, stored.get(source.path), store, context(source))] as [string, () => Promise<number>]),
    ...copilot.map((source) => [source.path, () => loadCopilot(source, stored.get(source.path), store, context(source))] as [string, () => Promise<number>]),
  ]
  let files = 0
  let lines = 0
  let failed = 0
  for (const [path, load] of loads) {
    try {
      const read = await load()
      if (read > 0) files++
      lines += read
    } catch (error) {
      if (error instanceof HubAway) return { state: 'away', files, lines }
      failed++
      log(`tally: ${path}: ${(error as Error).message}`)
    }
  }
  const forgotten = await marks.forgetExcept(loads.map(([path]) => path))
  return { state: 'done', files, lines, failed, forgotten }
}

/** The rows in posts of about `limit` bytes of JSON each; a row larger than that goes alone. None for no rows. */
export function slices(rows: MachineRows, limit: number): MachineRows[] {
  if (noRows(rows)) return []
  const parts: MachineRows[] = []
  let part = empty()
  let size = 0
  for (const name of ['sessions', 'messages', 'lines', 'calls', 'results'] as const) {
    for (const row of rows[name]) {
      const length = JSON.stringify(row).length
      if (size > 0 && size + length > limit) {
        parts.push(part)
        part = empty()
        size = 0
      }
      ;(part[name] as object[]).push(row)
      size += length
    }
  }
  parts.push(part)
  return parts
}

const empty = (): MachineRows => ({ lines: [], messages: [], calls: [], results: [], sessions: [] })
