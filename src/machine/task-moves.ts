import type { Db, Writes } from '../storage/database.js'

/** A task moved by hand off a machine gone (BTN-1270, `docs/machines.md`, "A machine gone"). */
export interface TaskMove {
  project: string
  task: string
  /** The machine it left: that machine takes it no more. */
  from: string
  /** Its branch on the remote, restored at its next launch. */
  branch: string
  at: number
  /** It has been launched since: the branch is restored and the note told. */
  launched: boolean
}

export interface TaskMoveDeps {
  db: Db
  writes: Writes
  now?: () => number
}

const keyOf = (project: string, task: string): string => `${project}\n${task}`

/** The tasks moved by hand off a machine gone (`task_moves`): read from memory, a change written behind. */
export class TaskMoves {
  private readonly moves = new Map<string, TaskMove>()
  private readonly now: () => number

  private constructor(private readonly deps: TaskMoveDeps, rows: TaskMove[]) {
    this.now = deps.now ?? Date.now
    for (const row of rows) this.moves.set(keyOf(row.project, row.task), row)
  }

  static async open(deps: TaskMoveDeps): Promise<TaskMoves> {
    const { rows } = await deps.db.query<{ project_id: string; task: string; from_machine: string; branch: string; moved_at: string; launched_at: string | null }>(
      'select project_id, task, from_machine, branch, moved_at, launched_at from task_moves order by moved_at, project_id, task',
    )
    return new TaskMoves(deps, rows.map((row) => ({
      project: row.project_id, task: row.task, from: row.from_machine, branch: row.branch, at: Number(row.moved_at), launched: row.launched_at !== null,
    })))
  }

  add(project: string, task: string, from: string, branch: string): TaskMove {
    const move: TaskMove = { project, task, from, branch, at: this.now(), launched: false }
    this.moves.set(keyOf(project, task), move)
    this.deps.writes.add(`the move of ${task}`, this.deps.db.query(
      `insert into task_moves (project_id, task, from_machine, branch, moved_at, launched_at) values ($1, $2, $3, $4, $5, null)
       on conflict (project_id, task) do update set from_machine = excluded.from_machine, branch = excluded.branch, moved_at = excluded.moved_at, launched_at = null`,
      [project, task, from, branch, move.at],
    ))
    return move
  }

  of(project: string, task: string): TaskMove | undefined {
    return this.moves.get(keyOf(project, task))
  }

  /** The machine the task was moved off; `undefined` — it was not moved. */
  from(project: string, task: string): string | undefined {
    return this.of(project, task)?.from
  }

  launched(project: string, task: string): void {
    const move = this.of(project, task)
    if (move === undefined || move.launched) return
    move.launched = true
    this.deps.writes.add(`the move of ${task}`, this.deps.db.query(
      'update task_moves set launched_at = $3 where project_id = $1 and task = $2', [project, task, this.now()],
    ))
  }

  /** The task's place is cleaned up: its move is over. */
  drop(project: string, task: string): void {
    if (!this.moves.delete(keyOf(project, task))) return
    this.deps.writes.add(`the move of ${task}`, this.deps.db.query('delete from task_moves where project_id = $1 and task = $2', [project, task]))
  }
}
