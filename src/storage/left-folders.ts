import type { LeftFolder } from '../sessions/lingering.js'
import type { Queryable } from './database.js'

/**
 * The worktree folders a cleanup after Done left while a process still held them (BTN-870), kept through a restart
 * (BTN-925); table `left_folders` (step 43, `docs/storage.md`). `until` is the end of the wait counted from the Done.
 */
export async function loadLeftFolders(db: Queryable): Promise<LeftFolder[]> {
  const { rows } = await db.query<{ path: string; project_id: string; task: string; repo: string; until: number | bigint }>(
    'select path, project_id, task, repo, until from left_folders order by path',
  )
  return rows.map((row) => ({ project: row.project_id, task: row.task, repo: row.repo, path: row.path, until: Number(row.until) }))
}

/** Starts its write at the call: see `Writes`. */
export async function saveLeftFolder(db: Queryable, folder: LeftFolder): Promise<void> {
  await db.query(
    `insert into left_folders (path, project_id, task, repo, until) values ($1, $2, $3, $4, $5)
       on conflict (path) do update set project_id = excluded.project_id, task = excluded.task, repo = excluded.repo, until = excluded.until`,
    [folder.path, folder.project, folder.task, folder.repo, folder.until],
  )
}

export async function dropLeftFolder(db: Queryable, path: string): Promise<void> {
  await db.query('delete from left_folders where path = $1', [path])
}
