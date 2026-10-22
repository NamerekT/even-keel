import { inTransaction, type Db, type Queryable } from '../storage/database.js'
import type { FileContents } from './file.js'
import { DEFINITIONS } from './registry.js'
import type { ProjectRecord, SettingRow } from './resolve.js'

/** Who wrote a row, `updated_by` of `setting_values`: the page, the service itself, the import at the first start, `config-import`. */
export type Writer = 'page' | 'service' | 'import' | 'hand'

interface ProjectRow {
  id: string
  key: string
  name: string | null
  repo: string
  branch: string
  tracker_projects: string
  feeds: string
}

interface ValueRow {
  key: string
  project_id: string | null
  qualifier: string
  value: string
}

/**
 * Writes the code's definitions into `setting_definitions` in one transaction, so that values have a foreign key and SQL
 * readers see what a key means. A definition the code dropped goes once no value names it; one a value still names
 * stays: removing a setting is a schema step that drops its rows. `spec` is `{}`: the checks are code.
 */
export function mirrorDefinitions(db: Db): Promise<void> {
  const rows = DEFINITIONS.map((definition) => ({
    key: definition.key,
    kind: definition.kind,
    spec: '{}',
    default_value: definition.default === undefined ? null : JSON.stringify(definition.default),
    scopes: definition.scopes.join(','),
    qualifier: definition.qualifier ?? null,
    task_label: definition.taskLabel ?? null,
  }))
  return inTransaction(db, async (tx) => {
    await tx.query(
      `insert into setting_definitions select * from json_populate_recordset(null::setting_definitions, $1)
       on conflict (key) do update set kind = excluded.kind, spec = excluded.spec, default_value = excluded.default_value,
         scopes = excluded.scopes, qualifier = excluded.qualifier, task_label = excluded.task_label`,
      [JSON.stringify(rows)],
    )
    await tx.query(
      `delete from setting_definitions d
        where d.key not in (select json_array_elements_text($1::json))
          and not exists (select 1 from setting_values v where v.key = d.key)`,
      [JSON.stringify(rows.map((row) => row.key))],
    )
  })
}

/** The project records in their order and every setting row, in one statement: a consistent snapshot while the service writes. */
export async function readSettings(db: Queryable): Promise<FileContents> {
  const { rows } = await db.query<{ settings: { projects: ProjectRow[]; values: ValueRow[] } }>(
    `select json_build_object(
       'projects', (select coalesce(json_agg(p order by p.position), '[]'::json) from projects p),
       'values', (select coalesce(json_agg(v order by v.key, v.project_id nulls first, v.qualifier), '[]'::json) from setting_values v)
     ) as settings`,
  )
  const { projects, values } = rows[0]!.settings
  return {
    records: projects.map(({ id, key, name, repo, branch, tracker_projects, feeds }) => {
      const list = JSON.parse(feeds) as Record<string, unknown>[]
      return { id, key, name, repo, branch, trackerProjects: JSON.parse(tracker_projects), ...(list.length === 0 ? {} : { feeds: list }) }
    }),
    rows: values.map(({ key, project_id, qualifier, value }) => ({ key, project: project_id, qualifier, value: JSON.parse(value) })),
  }
}

/**
 * Puts the records and rows in place of the stored ones in one statement, so that a write through the service's port is
 * whole too: records and rows it lacks go, a row whose value did not change keeps its `updated_at`. The rows are checked
 * before (`parseConfig`); a key without a definition is refused by the foreign key. Starts its write at the call: see
 * `Writes`.
 */
export async function saveSettings(db: Queryable, { records, rows }: FileContents, by: Writer, now: Date = new Date()): Promise<void> {
  const projects = records.map((record, position) => ({ ...projectRow(record), position }))
  await db.query(
    `with new_projects as (
       select * from json_to_recordset($1::json) as p(id text, key text, name text, repo text, branch text, tracker_projects text, feeds text, position integer)
     ),
     new_values as (
       select * from json_to_recordset($2::json) as v(key text, project_id text, qualifier text, value text)
     ),
     dropped_values as (
       delete from setting_values s
        where not exists (
          select 1 from new_values n where n.key = s.key and n.project_id is not distinct from s.project_id and n.qualifier = s.qualifier
        )
     ),
     dropped_projects as (
       delete from projects p where p.id not in (select id from new_projects)
     ),
     put_projects as (
       insert into projects (id, key, name, repo, branch, tracker_projects, feeds, position)
       select id, key, name, repo, branch, tracker_projects, feeds, position from new_projects
       on conflict (id) do update set key = excluded.key, name = excluded.name, repo = excluded.repo, branch = excluded.branch,
         tracker_projects = excluded.tracker_projects, feeds = excluded.feeds, position = excluded.position
     ),
     put_values as (
       insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by)
       select key, project_id, qualifier, value, $3, $4 from new_values
       on conflict (key, (coalesce(project_id, '')), qualifier) do update
         set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
         where setting_values.value is distinct from excluded.value
     )
     select 1`,
    [JSON.stringify(projects), JSON.stringify(rows.map(valueRow)), now.toISOString(), by],
  )
}

/** Sets the rows, leaving every other row as it is: the import of a v0.1 `chain.json`'s switches. */
export async function putSettings(db: Queryable, rows: SettingRow[], by: Writer, now: Date = new Date()): Promise<void> {
  await db.query(
    `insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by)
     select key, project_id, qualifier, value, $2, $3 from json_to_recordset($1::json) as v(key text, project_id text, qualifier text, value text)
     on conflict (key, (coalesce(project_id, '')), qualifier) do update
       set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [JSON.stringify(rows.map(valueRow)), now.toISOString(), by],
  )
}

const projectRow = ({ id, key, name, repo, branch, trackerProjects, feeds = [] }: ProjectRecord): ProjectRow => ({
  id,
  key,
  name,
  repo,
  branch,
  tracker_projects: JSON.stringify(trackerProjects),
  feeds: JSON.stringify(feeds),
})

const valueRow = ({ key, project, qualifier, value }: SettingRow): ValueRow => ({ key, project_id: project, qualifier, value: JSON.stringify(value) })

/** The records and rows as one text that two equal configs share, whatever order their rows came in. */
export function settingsText({ records, rows }: FileContents): string {
  const place = (row: SettingRow) => `${row.key}\u0000${row.project ?? ''}\u0000${row.qualifier}`
  const sorted = [...rows].sort((a, b) => (place(a) < place(b) ? -1 : place(a) > place(b) ? 1 : 0))
  return JSON.stringify({ records, rows: sorted.map((row) => [row.key, row.project, row.qualifier, row.value]) })
}
