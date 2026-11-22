import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The schema version of the Tally database (BTN-133). The collector migrates up to it
// (tally/src/migrations.ts, one step per version); the page refuses a database newer than this.
export const TALLY_SCHEMA_VERSION = 21

// The step files of the build on disk: the sources under tsx, the copies in `dist/tally/src/` from the build.
const STEP_FILES = fileURLToPath(new URL('../../tally/src/migrations/', import.meta.url))

/**
 * The schema version the build on disk migrates to: its last numbered step (`<n>-*.sql`). The service may run older code
 * than that until a restart (BTN-1208); 0 — no steps found.
 */
export function builtTallyVersion(dir: string = STEP_FILES): number {
  try {
    return Math.max(0, ...readdirSync(dir).map((file) => /^(\d+)-.*\.sql$/.exec(file)).map((match) => (match === null ? 0 : Number(match[1]))))
  } catch {
    return 0
  }
}

/** The collector's exit code when this code cannot migrate the database (newer, or rights missing): the service stops collecting until a restart. */
export const HALTED = 2

export interface Queryable {
  query<R extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>
}

/** 0 — no version recorded: an empty database or one created before versions. */
export async function tallyVersion(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ present: boolean }>(`select to_regclass('schema_version') is not null as present`)
  if (rows[0]?.present !== true) return 0
  const found = await db.query<{ version: number }>('select version from schema_version')
  return Number(found.rows[0]?.version ?? 0)
}
