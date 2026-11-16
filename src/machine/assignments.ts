import type { Db, Queryable, Writes } from '../storage/database.js'
import type { AssignedTask, AssignedTasks } from '../tracker/source.js'

interface Assignment extends AssignedTask {
  machine: string
  at: number
}

export interface AssignmentDeps {
  db: Db
  writes: Writes
  /** The project's chain order, as the dispatcher holds it. */
  order: (project: string) => string[]
  now?: () => number
}

const keyOf = (project: string, task: string): string => `${project}\n${task}`

/**
 * Which machine runs which task (`machine_tasks`, `docs/machines.md`, "Tasks to machines"): a task goes to a machine
 * with its launch and leaves it when its place there is cleaned up. The hub's own record, never a status: the tracker
 * does not know about machines. Read from memory; a change is written behind.
 */
export class Assignments implements AssignedTasks {
  private readonly held = new Map<string, Assignment>()
  private readonly now: () => number

  private constructor(private readonly deps: AssignmentDeps, rows: Assignment[]) {
    this.now = deps.now ?? Date.now
    for (const row of rows) this.held.set(keyOf(row.project, row.task), row)
  }

  static async open(deps: AssignmentDeps): Promise<Assignments> {
    const { rows } = await deps.db.query<{ project_id: string; task: string; machine_id: string; assigned_at: string }>(
      'select project_id, task, machine_id, assigned_at from machine_tasks order by assigned_at, project_id, task',
    )
    return new Assignments(deps, rows.map((row) => ({ project: row.project_id, task: row.task, machine: row.machine_id, at: Number(row.assigned_at) })))
  }

  /** The task is this machine's from now on; a task already on it keeps the time it went there. */
  assign(project: string, task: string, machine: string): void {
    const key = keyOf(project, task)
    if (this.held.get(key)?.machine === machine) return
    const at = this.now()
    this.held.delete(key)
    this.held.set(key, { project, task, machine, at })
    this.deps.writes.add(`the machine of ${task}`, this.deps.db.query(
      `insert into machine_tasks (project_id, task, machine_id, assigned_at) values ($1, $2, $3, $4)
       on conflict (project_id, task) do update set machine_id = excluded.machine_id, assigned_at = excluded.assigned_at`,
      [project, task, machine, at],
    ))
  }

  release(project: string, task: string): void {
    if (!this.held.delete(keyOf(project, task))) return
    this.deps.writes.add(`the machine of ${task}`, this.deps.db.query('delete from machine_tasks where project_id = $1 and task = $2', [project, task]))
  }

  machineOf(project: string, task: string): string | undefined {
    return this.held.get(keyOf(project, task))?.machine
  }

  /** The machine's tasks in the order they went to it. */
  of(machine: string): AssignedTask[] {
    return [...this.held.values()].filter((each) => each.machine === machine).map(({ project, task }) => ({ project, task }))
  }

  /** A task the chain's order no longer names comes after the ones it does, in the order it went to the machine. */
  assigned(machine: string): Promise<AssignedTask[]> {
    const byProject = new Map<string, string[]>()
    for (const { project, task } of this.of(machine)) byProject.set(project, [...(byProject.get(project) ?? []), task])
    const sorted = [...byProject].flatMap(([project, tasks]) => {
      const order = this.deps.order(project)
      const place = (task: string) => {
        const index = order.indexOf(task)
        return index === -1 ? order.length : index
      }
      return tasks.map((task, went) => ({ task, went })).sort((a, b) => place(a.task) - place(b.task) || a.went - b.went).map(({ task }) => ({ project, task }))
    })
    return Promise.resolve(sorted)
  }
}

/** Puts the machine into the pool of every project that has no machine at all: a project's own choice is left alone. */
export async function fillPool(db: Queryable, machine: string, projects: string[]): Promise<void> {
  for (const project of projects) {
    await db.query(
      `insert into project_machines (project_id, machine_id)
       select $1, $2 where not exists (select 1 from project_machines where project_id = $1)`,
      [project, machine],
    )
  }
}

/** The machines the project may run on, the ones turned off left out. */
export async function poolOf(db: Queryable, project: string): Promise<string[]> {
  const { rows } = await db.query<{ machine_id: string }>('select machine_id from project_machines where project_id = $1 and enabled order by machine_id', [project])
  return rows.map((row) => row.machine_id)
}
