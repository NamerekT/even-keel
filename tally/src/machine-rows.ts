import type { Batch, CallRow, LineRow, MessageRow, ResultRow, SessionRow } from './parse.js'

/**
 * What a machine elsewhere sends its hub of one read chunk (BTN-1280, `docs/tally.md`, "Machines elsewhere"): the rows
 * its loaders parsed. No rule rows: a machine's own environment is its administrator's, not the hub's rule history.
 */
export interface MachineRows {
  lines: LineRow[]
  messages: MessageRow[]
  calls: CallRow[]
  results: ResultRow[]
  sessions: SessionRow[]
}

export function rowsOf(batch: Batch): MachineRows {
  return {
    lines: [...batch.lines.values()],
    messages: [...batch.messages.values()],
    calls: [...batch.calls.values()],
    results: [...batch.results.values()],
    sessions: [...batch.sessions.values()],
  }
}

export const noRows = (rows: MachineRows): boolean =>
  rows.lines.length + rows.messages.length + rows.calls.length + rows.results.length + rows.sessions.length === 0

/**
 * The account of a machine's row in the hub's database: `global` there is another folder than the hub's `global`, and
 * the limit shares and the spend by account must not mix them.
 */
export const machineAccount = (account: string, machine: string): string => `${account}@${machine}`

const LISTS = ['lines', 'messages', 'calls', 'results', 'sessions'] as const

/** The rows as they came over the wire: every list an array of objects; anything else is refused whole. */
export function isMachineRows(value: unknown): value is MachineRows {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const rows = value as Record<string, unknown>
  return LISTS.every((name) => Array.isArray(rows[name]) && (rows[name] as unknown[]).every((row) => typeof row === 'object' && row !== null && !Array.isArray(row)))
}
