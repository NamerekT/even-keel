import type { Db } from '../storage/database.js'
import type { TrackerAdapter } from '../tracker/source.js'
import { BUILTIN_MOVES } from './model.js'

let database: Db | undefined

/** The service hands the built-in tracker its state database at start; without it the tracker is off. */
export function attachBuiltin(db: Db | undefined): void {
  database = db
}

/**
 * The built-in tracker (BTN-767): tasks in Even Keel's own state database, no account, no profile, no keys. Its statuses
 * and the statuses Even Keel moves its tasks into are fixed (`BUILTIN_STATUSES`, `BUILTIN_MOVES`).
 */
export const builtin: TrackerAdapter = {
  title: 'Even Keel',
  variables: [],
  hostVariables: [],
  help: '',
  own: true,
  moves: true,
  fixedMoves: BUILTIN_MOVES,
  // Sessions edit its tasks through Even Keel's own tasks server, the `tasks` plugin (BTN-768).
  mcpServer: 'tasks',
  keepsBrief: true,
  profileName: () => 'Even Keel',
  account: async () => ({ login: 'Even Keel', name: 'Even Keel', expiresAt: null }),
  projects: async () => [],
  setup(_env, places) {
    const db = database
    if (db === undefined) return undefined
    return {
      connect: async () => (await import('./source.js')).builtinSource(db, places),
      issueUrl: () => null,
    }
  },
}
