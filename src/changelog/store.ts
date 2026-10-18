import type { TokenTotals } from '../sessions/transcript.js'
import type { ChangelogKind, ChangelogSpend, ChangelogSpent, ChangelogVersion } from '../state.js'
import type { Db, Queryable } from '../storage/database.js'
import { byMap, inverted } from '../storage/projects.js'

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
  spend: string | null
}

const COLUMNS = 'project_id, milestone, version, kind, text, base, instruction, tasks, open_tasks, at, written_at, commit_sha, spend'

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
  spend: row.spend === null ? null : (JSON.parse(row.spend) as ChangelogSpend),
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
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5, $6, $7, $8, $9, null, null, $10
       from changelog_versions where project_id = $1 and milestone = $2
     returning version`,
    [
      byMap(ids)(version.project),
      version.milestone,
      version.kind,
      version.text,
      version.base,
      version.instruction,
      JSON.stringify(version.tasks),
      version.open,
      version.at,
      version.spend === null ? null : JSON.stringify(version.spend),
    ],
  )
  return rows[0]!.version
}

/** What every turn of the milestone's versions cost together; a version kept without its spend counts for nothing. */
export async function spentOn(db: Queryable, project: string, milestone: string, ids: Record<string, string> = {}): Promise<ChangelogSpent> {
  const { rows } = await db.query<{ spend: string }>('select spend from changelog_versions where project_id = $1 and milestone = $2 and spend is not null', [
    byMap(ids)(project),
    milestone,
  ])
  const spent: ChangelogSpent = { turns: 0, cost: 0, unpriced: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  for (const row of rows) {
    const spend = JSON.parse(row.spend) as ChangelogSpend
    spent.turns += 1
    if (spend.cost === null) spent.unpriced += 1
    else spent.cost += spend.cost
    for (const key of Object.keys(spent.tokens) as (keyof TokenTotals)[]) spent.tokens[key] += spend.tokens[key]
  }
  return spent
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
