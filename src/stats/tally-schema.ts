// The schema version of the Tally database (BTN-133). The collector migrates up to it
// (tally/src/migrations.ts, one step per version); the page refuses a database newer than this.
export const TALLY_SCHEMA_VERSION = 9

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
