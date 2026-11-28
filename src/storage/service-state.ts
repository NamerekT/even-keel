import type { Queryable } from './database.js'

/**
 * Single values of the service's own state, `service_state` (BTN-199): `updates.dismissed` — the version whose toast the
 * user closed; `config.imported` — when the first start looked for `even-keel.config.json` to import;
 * `profiles.imported` — when the first start made tracker profiles of the trackers' variables of `.env` (BTN-200);
 * `profiles.forgejo.imported` — when the first start made Forgejo profiles of `FORGEJO_TOKEN` (BTN-201);
 * `intake` — the GitHub issues taken into the projects' trackers and not closed yet (`IntakeEntry[]`, BTN-262);
 * `cliCheck.history` — per agent, the automatic CLI check's last lookup, versions tried and last result (`CheckHistory`, BTN-569);
 * `notices.dismissed` — the page's "Got it" marks, a banner's id to the stamp it was closed at (BTN-759, `withDismissed`);
 * `eventLog.memory` — what the event log saw last, so a restart writes nothing that held before it (`EventMemory`, BTN-350);
 * `cli.downloaded` — the providers whose checked CLI copy was once downloaded with consent (`string[]`, BTN-1175);
 * `machines.certificate` — the hub's certificate and key for machines (`HubCertificate`, BTN-988, `hubIdentity`);
 * `machines.own` — the id of the machine this installation itself is (BTN-1216, `ownMachine`);
 * `memory.transferred` — the projects whose `memory_records` went into their memory folder on the hub (`string[]`, BTN-1646);
 * `memory.folders` — by machine, its folders outside the projects' pools bound to their memory (`MemoryFolder[]`, BTN-1648);
 * `config.own` — the machines whose `settings.json` and `CLAUDE.md` stay out of the configuration's sync (`string[]`, BTN-1745).
 */
export type StateName =
  | 'updates.dismissed'
  | 'config.imported'
  | 'profiles.imported'
  | 'profiles.forgejo.imported'
  | 'intake'
  | 'cliCheck.history'
  | 'notices.dismissed'
  | 'eventLog.memory'
  | 'cli.downloaded'
  | 'machines.certificate'
  | 'machines.own'
  | 'memory.transferred'
  | 'memory.folders'
  | 'config.own'

/** `undefined` — never written. */
export async function stateValue(db: Queryable, name: StateName): Promise<unknown> {
  const { rows } = await db.query<{ value: string }>('select value from service_state where name = $1', [name])
  return rows[0] === undefined ? undefined : JSON.parse(rows[0].value)
}

/** Starts its write at the call: see `Writes`. */
export async function setStateValue(db: Queryable, name: StateName, value: unknown): Promise<void> {
  await db.query('insert into service_state (name, value) values ($1, $2) on conflict (name) do update set value = excluded.value', [name, JSON.stringify(value)])
}
