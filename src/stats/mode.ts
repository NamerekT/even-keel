/** Where Tally writes (BTN-247): nowhere, its embedded database in the state folder, or the user's own Postgres from `.env`. */
export const TALLY_MODES = ['off', 'local', 'server'] as const
export type TallyMode = (typeof TALLY_MODES)[number]

export const isTallyMode = (value: unknown): value is TallyMode => (TALLY_MODES as readonly unknown[]).includes(value)

/** Why the stats answer `off`: the user turned them off, or has not chosen yet; any other reason is the `.env` variables missing. */
export const TALLY_DISABLED = 'disabled'
export const TALLY_UNCHOSEN = 'unchosen'

/** The variables of the user's own Postgres that pick it and move it: a change restarts the collector on the new one. */
export const TALLY_DATABASE = /^TALLY_(DB|READER|WRITER)_/

/**
 * The mode of an installation that has not chosen: one Tally already ran on keeps running there (`TALLY_DB_HOST` set, or
 * the embedded database exists); otherwise `null` — nothing is collected or created until the user chooses.
 */
export function inferredTallyMode(env: Record<string, string | undefined>, localExists: boolean): TallyMode | null {
  if (env.TALLY_DB_HOST) return 'server'
  return localExists ? 'local' : null
}

/** What the collector and the reader depend on: the mode and the database's variables. A change of it restarts Tally. */
export function tallyKey(mode: TallyMode | null, env: Record<string, string | undefined>): string {
  const database = Object.keys(env)
    .filter((name) => TALLY_DATABASE.test(name) && env[name])
    .sort()
    .map((name) => [name, env[name]])
  return JSON.stringify([mode, database])
}
