import { inTransaction, type Queryable } from '../storage/database.js'
import type { PGlite } from '@electric-sql/pglite'

/**
 * The machine's own values, table `machine_state` of its database (`docs/storage.md`, "The machine's database"):
 * `cli.downloaded` — the providers whose checked CLI copy was once downloaded with consent (`string[]`, BTN-1175);
 * `stores.imported` — when the machine's stores were moved from the state database (BTN-1246).
 */
export type MachineStateName = 'cli.downloaded' | 'stores.imported' | 'stores.hostImported' | 'cliCheck.history' | 'accounts.adoptLegacy' | 'cli'

export async function machineValue(db: Queryable, name: MachineStateName): Promise<unknown> {
  const { rows } = await db.query<{ value: string }>('select value from machine_state where name = $1', [name])
  return rows[0] === undefined ? undefined : JSON.parse(rows[0].value)
}

/** Starts its write at the call: see `Writes`. */
export async function setMachineValue(db: Queryable, name: MachineStateName, value: unknown): Promise<void> {
  await db.query('insert into machine_state (name, value) values ($1, $2) on conflict (name) do update set value = excluded.value', [name, JSON.stringify(value)])
}

/**
 * Moves the machine's stores from the state database into the machine's own, once (BTN-1246): the account folders'
 * limits and settings and the CLI copies downloaded. The state database's rows stay as they were and are read no more.
 * `true` — moved now.
 */
export async function importMachineStores(machineDb: PGlite, stateDb: Queryable, now: Date): Promise<boolean> {
  const initial = await importInitialStores(machineDb, stateDb, now)
  if (await machineValue(machineDb, 'stores.hostImported') !== undefined) return initial
  const tables = ['global_accounts', 'key_organizations', 'management_keys', 'left_folders', 'context_windows'] as const
  const rows = await Promise.all(tables.map(async (table) => (await stateDb.query<Record<string, unknown>>(`select * from ${table}`)).rows))
  const values = await stateDb.query<{ name: string; value: string }>("select name, value from service_state where name in ('cliCheck.history', 'accounts.adoptLegacy')")
  await inTransaction(machineDb, async (tx) => {
    for (const [index, table] of tables.entries()) {
      for (const row of rows[index]!) {
        const columns = Object.keys(row)
        await tx.query(`insert into ${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) on conflict do nothing`, Object.values(row))
      }
    }
    for (const { name, value } of values.rows) await tx.query('insert into machine_state (name, value) values ($1, $2) on conflict do nothing', [name, value])
    await setMachineValue(tx, 'stores.hostImported', now.toISOString())
  })
  return true
}

async function importInitialStores(machineDb: PGlite, stateDb: Queryable, now: Date): Promise<boolean> {
  if (await machineValue(machineDb, 'stores.imported') !== undefined) return false
  const limits = await stateDb.query<{ account: string; limits: string }>('select account, limits from account_limits')
  const settings = await stateDb.query<{ account: string; written: string; own: string; saved_at: string }>('select account, written, own, saved_at from account_settings')
  const downloaded = await stateDb.query<{ value: string }>(`select value from service_state where name = 'cli.downloaded'`)
  await inTransaction(machineDb, async (tx) => {
    for (const row of limits.rows) {
      await tx.query('insert into account_limits (account, limits) values ($1, $2) on conflict (account) do nothing', [row.account, row.limits])
    }
    for (const row of settings.rows) {
      await tx.query('insert into account_settings (account, written, own, saved_at) values ($1, $2, $3, $4) on conflict (account) do nothing', [row.account, row.written, row.own, row.saved_at])
    }
    const cli = downloaded.rows[0]?.value
    if (cli !== undefined) await tx.query(`insert into machine_state (name, value) values ('cli.downloaded', $1) on conflict (name) do nothing`, [cli])
    await tx.query(`insert into machine_state (name, value) values ('stores.imported', $1)`, [JSON.stringify(now.toISOString())])
  })
  return true
}
