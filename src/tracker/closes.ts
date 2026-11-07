import type { Queryable } from '../storage/database.js'

/** A task the merge closer closed (BTN-689): the own commits of its branch main had then (`mergedCommits`). */
export interface MergeMark {
  /** The reader's id: a project's or a feed's. */
  project: string
  task: string
  commits: string[]
  closedAt: string
}

/**
 * What the merge closer closed, by reader and task. A reopened task is closed again only for a commit its mark lacks,
 * and the marks outlive a restart through `save`, written behind into `merge_closes` (step 26, `docs/storage.md`).
 */
export class MergeMarks {
  private readonly marks = new Map<string, MergeMark>()

  constructor(
    loaded: MergeMark[] = [],
    private readonly save: (mark: MergeMark) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const mark of loaded) this.marks.set(keyOf(mark.project, mark.task), mark)
  }

  of(project: string, task: string): string[] | undefined {
    return this.marks.get(keyOf(project, task))?.commits
  }

  mark(project: string, task: string, commits: string[]): void {
    const mark = { project, task, commits, closedAt: this.now().toISOString() }
    this.marks.set(keyOf(project, task), mark)
    this.save(mark)
  }

  /** Drops the project's marks in memory; their rows go with `forgetProjectRows`. */
  forget(project: string): void {
    for (const [key, mark] of this.marks) if (mark.project === project) this.marks.delete(key)
  }

  /** Takes commits merged while the chain did not hold the reopened task as old ones (BTN-694); the close time stays. */
  absorb(project: string, task: string, commits: string[]): void {
    const before = this.marks.get(keyOf(project, task))
    if (before === undefined) return
    const added = commits.filter((commit) => !before.commits.includes(commit))
    if (added.length === 0) return
    const mark = { ...before, commits: [...before.commits, ...added] }
    this.marks.set(keyOf(project, task), mark)
    this.save(mark)
  }
}

const keyOf = (project: string, task: string) => `${project}\n${task}`

export async function loadMergeMarks(db: Queryable): Promise<MergeMark[]> {
  const { rows } = await db.query<{ project_id: string; task: string; commits: string; closed_at: string }>(
    'select project_id, task, commits, closed_at from merge_closes order by project_id, task',
  )
  return rows.map((row) => ({ project: row.project_id, task: row.task, commits: JSON.parse(row.commits) as string[], closedAt: row.closed_at }))
}

/** Starts its write at the call: see `Writes`. */
export async function saveMergeMark(db: Queryable, mark: MergeMark): Promise<void> {
  await db.query(
    `insert into merge_closes (project_id, task, commits, closed_at) values ($1, $2, $3, $4)
     on conflict (project_id, task) do update set commits = excluded.commits, closed_at = excluded.closed_at`,
    [mark.project, mark.task, JSON.stringify(mark.commits), mark.closedAt],
  )
}
