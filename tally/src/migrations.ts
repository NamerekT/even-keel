import { readFileSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import type pg from 'pg'
import { tallyVersion, type Queryable } from '../../src/stats/tally-schema.js'

// Numbered schema steps (BTN-133): STEPS[n] takes the database from version n to n + 1, each in one
// transaction with the new version. Version 1 is schema.sql as of the first release; a database from
// before versions has no schema_version and gets schema.sql again (it is idempotent) to become version 1.
// A step is never edited or removed once merged: a schema change is a new step.

export const STEPS: readonly string[] = ['./schema.sql', './migrations/2-false-rule-deletions.sql', './migrations/3-gpt-family.sql', './migrations/4-compactions.sql', './migrations/5-milestones.sql', './migrations/6-task-sources.sql'].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))

const VERSION_TABLE = `
create table if not exists schema_version (
  only_row boolean primary key default true check (only_row),
  version integer not null,
  migrated_at timestamptz not null default now()
)`

export interface SchemaDb extends Queryable {
  /** Several statements, no parameters. */
  exec(sql: string): Promise<unknown>
}

export interface Fix {
  role: string
  sql: string
}

export type Migration =
  | { state: 'current'; version: number }
  | { state: 'migrated'; from: number; to: number }
  | { state: 'newer'; version: number; known: number }
  | { state: 'denied'; from: number; to: number; user: string; fixes: Fix[] }

export const pgliteDb = (db: PGlite): SchemaDb => ({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) })
export const pgDb = (client: pg.Client): SchemaDb => ({ query: (sql, params) => client.query(sql, params), exec: (sql) => client.query(sql) })

export async function migrate(db: SchemaDb, steps: readonly string[] = STEPS): Promise<Migration> {
  const known = steps.length
  const from = await tallyVersion(db)
  if (from > known) return { state: 'newer', version: from, known }
  if (from === known) return { state: 'current', version: from }
  const rights = await missingRights(db)
  if (rights.fixes.length > 0) return { state: 'denied', from, to: known, ...rights }
  for (let version = from; version < known; version++) {
    await db.exec('begin')
    try {
      if (version === 0) await db.exec(VERSION_TABLE)
      await db.exec(steps[version]!)
      const moved =
        version === 0
          ? await db.query('insert into schema_version (version) values (1) on conflict do nothing returning version')
          : await db.query('update schema_version set version = $2, migrated_at = now() where version = $1 returning version', [version, version + 1])
      if (moved.rows.length === 0) throw new Error(`tally: schema_version moved away from ${version} during the migration`)
      await db.exec('commit')
    } catch (error) {
      await db.exec('rollback')
      throw error
    }
  }
  return { state: 'migrated', from, to: known }
}

// A step may alter any table and create new ones: that takes the owner of every relation and CREATE on the schema.
async function missingRights(db: SchemaDb): Promise<{ user: string; fixes: Fix[] }> {
  const owned = await db.query<{ name: string; kind: string; owner: string }>(`
    select quote_ident(c.relname) as name, c.relkind::text as kind, pg_get_userbyid(c.relowner) as owner
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and c.relowner <> (select oid from pg_roles where rolname = current_user)
      and not (select rolsuper from pg_roles where rolname = current_user)
    order by c.relname`)
  const schema = await db.query<{ create: boolean; owner: string; user: string }>(`
    select has_schema_privilege('public', 'CREATE') as create, quote_ident(current_user) as user,
      case when nspowner = to_regrole('pg_database_owner')
        then (select pg_get_userbyid(datdba) from pg_database where datname = current_database())
        else pg_get_userbyid(nspowner) end as owner
    from pg_namespace where nspname = 'public'`)
  const { create, owner, user } = schema.rows[0]!
  const fixes = owned.rows.map((row) => ({ role: row.owner, sql: `alter ${KINDS[row.kind] ?? 'table'} ${row.name} owner to ${user}` }))
  if (!create) fixes.push({ role: owner, sql: `grant create on schema public to ${user}` })
  return { user, fixes }
}

const KINDS: Record<string, string> = { v: 'view', m: 'materialized view', S: 'sequence' }

/** One log line for a database that was migrated; null when nothing changed. */
export function migratedLine(migration: Migration): string | null {
  if (migration.state !== 'migrated') return null
  return `tally: database schema ${migration.from === 0 ? 'unversioned' : `v${migration.from}`} → v${migration.to}`
}

/** One log line: what the database needs before the collector can migrate it. */
export function deniedLine(migration: Extract<Migration, { state: 'denied' }>): string {
  const roles = [...new Set(migration.fixes.map((fix) => fix.role))]
  const runs = roles.map((role) => `as ${role}: ${migration.fixes.filter((fix) => fix.role === role).map((fix) => `${fix.sql};`).join(' ')}`)
  return (
    `tally: the database needs schema v${migration.from}→v${migration.to}, but ${migration.user} lacks the rights; nothing was changed. ` +
    `Run ${runs.join(' and ')} — then restart Even Keel`
  )
}
