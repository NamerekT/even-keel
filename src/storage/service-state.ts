import type { Queryable } from './database.js'

/**
 * Single values of the service's own state, `service_state` (BTN-199): `updates.dismissed` — the version whose toast the
 * user closed; `config.imported` — when the first start looked for `even-keel.config.json` to import;
 * `profiles.imported` — when the first start made tracker profiles of the trackers' variables of `.env` (BTN-200);
 * `profiles.forgejo.imported` — when the first start made Forgejo profiles of `FORGEJO_TOKEN` (BTN-201);
 * `intake` — the GitHub issues taken into the projects' trackers and not closed yet (`IntakeEntry[]`, BTN-262).
 */
export type StateName = 'updates.dismissed' | 'config.imported' | 'profiles.imported' | 'profiles.forgejo.imported' | 'intake'

/** `undefined` — never written. */
export async function stateValue(db: Queryable, name: StateName): Promise<unknown> {
  const { rows } = await db.query<{ value: string }>('select value from service_state where name = $1', [name])
  return rows[0] === undefined ? undefined : JSON.parse(rows[0].value)
}

/** Starts its write at the call: see `Writes`. */
export async function setStateValue(db: Queryable, name: StateName, value: unknown): Promise<void> {
  await db.query('insert into service_state (name, value) values ($1, $2) on conflict (name) do update set value = excluded.value', [name, JSON.stringify(value)])
}
