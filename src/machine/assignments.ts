import type { Db, Queryable, Writes } from '../storage/database.js'
import { stateValue } from '../storage/service-state.js'
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
  /** The machine the task was moved off by hand (`TaskMoves`, BTN-1270); `undefined` — it was not moved. */
  movedFrom?: (project: string, task: string) => string | undefined
  /** A machine of the hub other than `machine` with a live session of the task (BTN-1625); `undefined` — none. */
  liveElsewhere?: (project: string, task: string, machine: string) => string | undefined
  now?: () => number
}

/**
 * What squaring a machine's rows with its snapshot changed; `from` — the machine the task's row named before.
 * `refused` — the tasks with a live session there that were moved off the machine: they stay where they went.
 * `rehomed` — the tasks the machine does not know whose live session another machine has: their rows went there.
 */
export interface HeldChanges {
  removed: AssignedTask[]
  added: Array<AssignedTask & { from?: string }>
  refused: AssignedTask[]
  rehomed: Array<AssignedTask & { to: string }>
}

const keyOf =(project: string, task: string): string => `${project}\n${task}`

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

  /**
   * Squares the machine's rows with its snapshot: a row of a task the machine no longer names goes, or goes to the
   * machine with a live session of it (BTN-1625: a launch the hub ran in another machine's place), and a task with a
   * live session there becomes its own, unless it was moved off the machine by hand. `named` is every task the machine
   * knows a session of; a stopped one keeps its row, since its place is cleaned up only with `finish`.
   */
  reconcile(machine: string, named: ReadonlySet<string>, live: AssignedTask[]): HeldChanges {
    const removed: AssignedTask[] = []
    const rehomed: HeldChanges['rehomed'] = []
    for (const { project, task } of this.of(machine).filter((each) => !named.has(each.task))) {
      const to = this.deps.liveElsewhere?.(project, task, machine)
      if (to === undefined || this.deps.movedFrom?.(project, task) === to) {
        this.release(project, task)
        removed.push({ project, task })
      } else {
        this.assign(project, task, to)
        rehomed.push({ project, task, to })
      }
    }
    const added: HeldChanges['added'] = []
    const refused: AssignedTask[] = []
    for (const { project, task } of live) {
      const was = this.machineOf(project, task)
      if (was === machine) continue
      if (this.deps.movedFrom?.(project, task) === machine) {
        refused.push({ project, task })
        continue
      }
      this.assign(project, task, machine)
      added.push({ project, task, ...(was === undefined ? {} : { from: was }) })
    }
    return { removed, added, refused, rehomed }
  }

  machineOf(project: string, task: string): string | undefined {
    return this.held.get(keyOf(project, task))?.machine
  }

  /** Every row, in the order the tasks went to their machines. */
  all(): Array<AssignedTask & { machine: string }> {
    return [...this.held.values()].map(({ project, task, machine }) => ({ project, task, machine }))
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

/**
 * By project, how many machines its list "The project's machines" holds, turned on or off (BTN-1571): the own one and
 * the joined ones not revoked, as `MachineNetwork.machinesIn` counts them; a project with none named is not there.
 */
export async function listedMachines(db: Queryable): Promise<Map<string, number>> {
  const own = ((await stateValue(db, 'machines.own')) as string | undefined) ?? null
  const { rows } = await db.query<{ project_id: string; machines: number }>(
    `select pm.project_id, count(*)::int as machines from project_machines pm join machines m on m.id = pm.machine_id
     where m.revoked_at is null and (m.joined_at is not null or m.id = $1) group by pm.project_id`,
    [own],
  )
  return new Map(rows.map((row) => [row.project_id, row.machines]))
}

/** The machine has a folder of the project in its pool, turned on or off (a connect's checks run on one turned off). */
export async function placedIn(db: Queryable, project: string, machine: string): Promise<boolean> {
  const { rows } = await db.query('select 1 from project_machines where project_id = $1 and machine_id = $2', [project, machine])
  return rows.length > 0
}
