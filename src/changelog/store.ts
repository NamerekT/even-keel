import type { Db, Queryable } from '../storage/database.js'
import { byMap, inverted } from '../storage/projects.js'

/** How a version came: the first draft, "write again", the user's edit, the new tasks added. */
export type ChangelogKind = 'draft' | 'again' | 'edit' | 'add'

/** One version of a milestone's changelog draft (BTN-209): the history of the dialog, not a copy of the file. */
export interface ChangelogVersion {
  /** The project key. */
  project: string
  milestone: string
  /** From 1, per project and milestone. */
  number: number
  kind: ChangelogKind
  /** The section, Markdown. */
  text: string
  /** What the page shows the changes against; `null` — nothing, the whole text is new. */
  base: string | null
  /** The user's words of an edit. */
  instruction: string | null
  /** The ids of the tasks the version accounts for. */
  tasks: string[]
  /** How many of the milestone's tasks were open. */
  open: number
  /** ISO. */
  at: string
  /** When it was written to the file, by which commit. */
  written: { at: string; commit: string } | null
}

type Row = {
  project_id: string
  milestone: string
  version: number
  kind: ChangelogKind
  text: string
  base: string | null
  instruction: string | null
  tasks: string
  open_tasks: number
  at: string
  written_at: string | null
  commit_sha: string | null
}

const COLUMNS = 'project_id, milestone, version, kind, text, base, instruction, tasks, open_tasks, at, written_at, commit_sha'

const versionOf = (keyOf: (id: string) => string) => (row: Row): ChangelogVersion => ({
  project: keyOf(row.project_id),
  milestone: row.milestone,
  number: row.version,
  kind: row.kind,
  text: row.text,
  base: row.base,
  instruction: row.instruction,
  tasks: JSON.parse(row.tasks) as string[],
  open: row.open_tasks,
  at: row.at,
  written: row.written_at === null || row.commit_sha === null ? null : { at: row.written_at, commit: row.commit_sha },
})

export async function latestVersion(db: Queryable, project: string, milestone: string, ids: Record<string, string> = {}): Promise<ChangelogVersion | null> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from changelog_versions where project_id = $1 and milestone = $2 order by version desc limit 1`,
    [byMap(ids)(project), milestone],
  )
  return rows[0] === undefined ? null : versionOf(byMap(inverted(ids)))(rows[0])
}

/** Stores the next version of the milestone; its number. */
export async function addVersion(
  db: Db,
  version: Omit<ChangelogVersion, 'number' | 'written'>,
  ids: Record<string, string> = {},
): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    `insert into changelog_versions (${COLUMNS})
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5, $6, $7, $8, $9, null, null
       from changelog_versions where project_id = $1 and milestone = $2
     returning version`,
    [byMap(ids)(version.project), version.milestone, version.kind, version.text, version.base, version.instruction, JSON.stringify(version.tasks), version.open, version.at],
  )
  return rows[0]!.version
}

export async function markWritten(db: Db, project: string, milestone: string, number: number, written: { at: string; commit: string }, ids: Record<string, string> = {}): Promise<void> {
  await db.query('update changelog_versions set written_at = $4, commit_sha = $5 where project_id = $1 and milestone = $2 and version = $3', [
    byMap(ids)(project),
    milestone,
    number,
    written.at,
    written.commit,
  ])
}

/** The tasks the last written version of each milestone accounts for, by project key and milestone. */
export async function writtenTasks(db: Queryable, ids: Record<string, string> = {}): Promise<Record<string, Record<string, string[]>>> {
  const keyOf = byMap(inverted(ids))
  const { rows } = await db.query<{ project_id: string; milestone: string; tasks: string }>(
    `select distinct on (project_id, milestone) project_id, milestone, tasks from changelog_versions
      where written_at is not null order by project_id, milestone, version desc`,
  )
  const result: Record<string, Record<string, string[]>> = {}
  for (const row of rows) (result[keyOf(row.project_id)] ??= {})[row.milestone] = JSON.parse(row.tasks) as string[]
  return result
}
