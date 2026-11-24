import type { MachinePort } from '../machine/port.js'
import { shortCommit } from '../ci/verdict.js'
import { englishOf } from '../notice/notice.js'

export interface PoolAfterGreenDeps {
  own: () => string
  /** The machines of the project's pool turned on, with their commands after a green main and the last commit they ran on. */
  pool: (project: string, machine?: string) => Promise<Array<{ machine: string; commands: string[]; ran: string | null }>>
  /** The projects whose pool has the machine turned on. */
  projectsOf: (machine: string) => Promise<string[]>
  /** Writes the commit a machine's commands start on, before they start. */
  mark: (project: string, machine: string, commit: string) => Promise<void>
  /** The machine elsewhere takes the hub's commands now: on the link and of the hub's version. */
  ready: (machine: string) => boolean
  port: (machine: string) => Pick<MachinePort, 'runAfterGreen'> | undefined
  /** The last green commit of the project's main with the guard on; `undefined` — none. */
  green: (project: string) => string | undefined
  /** The name the hub gave the machine, for the log (BTN-1597). */
  name: (machine: string) => string
  log: (message: string) => void
}

/**
 * The commands after a green main on the machines elsewhere of a project's pool (BTN-994, `docs/machines.md`, "After a
 * green main"): each machine with commands of its own or the project's brings its clone's main up to the green commit and
 * runs them there, one run at a time per machine and project, the latest green commit next. A machine off the link
 * catches up once when it is back, on the last green commit only. The own machine's run is the chain's (`MainCheck`).
 */
export class PoolAfterGreen {
  /** The run going on, by machine and project, and the green commit due after it. */
  private readonly runs = new Map<string, { next?: string }>()
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly deps: PoolAfterGreenDeps) {}

  /** Main of the project went green at `commit`. */
  green(project: string, commit: string): void {
    this.track(this.spread(project, commit))
  }

  /** A machine elsewhere is back on the link with its brief: what it missed runs once, on the last green commit. */
  back(machine: string): void {
    this.track(this.catchUp(machine))
  }

  /** Settles when every run started so far has ended: for tests. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }

  private async spread(project: string, commit: string): Promise<void> {
    for (const row of await this.deps.pool(project)) {
      if (row.machine === this.deps.own() || row.commands.length === 0 || row.ran === commit) continue
      if (this.deps.ready(row.machine)) this.run(project, row.machine, commit)
    }
  }

  private async catchUp(machine: string): Promise<void> {
    if (machine === this.deps.own() || !this.deps.ready(machine)) return
    for (const project of await this.deps.projectsOf(machine)) {
      const commit = this.deps.green(project)
      if (commit === undefined) continue
      const [row] = await this.deps.pool(project, machine)
      if (row === undefined || row.commands.length === 0 || row.ran === commit) continue
      this.deps.log(`afterGreen: ${project}: machine ${this.named(machine)} is back and catches up on ${shortCommit(commit)}`)
      this.run(project, machine, commit)
    }
  }

  private run(project: string, machine: string, commit: string): void {
    const key = `${project}\u0000${machine}`
    const running = this.runs.get(key)
    if (running !== undefined) {
      running.next = commit
      return
    }
    this.runs.set(key, {})
    this.track(this.once(project, machine, commit).finally(() => {
      const next = this.runs.get(key)?.next
      this.runs.delete(key)
      if (next !== undefined && next !== commit) this.run(project, machine, next)
    }))
  }

  /** The mark goes first: a command may restart the machine's service, and the run is not repeated after it. */
  private async once(project: string, machine: string, commit: string): Promise<void> {
    const short = shortCommit(commit)
    const port = this.deps.port(machine)
    if (port === undefined) return
    const named = this.named(machine)
    try {
      await this.deps.mark(project, machine, commit)
      this.deps.log(`afterGreen: ${project}: machine ${named} runs the commands after ${short}`)
      const run = await port.runAfterGreen(project, commit, true)
      if (run.state === 'done') this.deps.log(`afterGreen: ${project}: machine ${named} is done with the commands after ${short}`)
      else if (run.state === 'skipped') this.deps.log(`afterGreen: ${project}: machine ${named} skipped them after ${short}: ${englishOf(run.reason)}`)
      else this.deps.log(`afterGreen: ${project}: machine ${named}: ${run.failure.command} after ${short} exited with ${run.failure.code}`)
    } catch (error) {
      this.deps.log(`afterGreen: ${project}: machine ${named} did not run the commands after ${short}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private named(machine: string): string {
    return JSON.stringify(this.deps.name(machine))
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch((error: unknown) => this.deps.log(`afterGreen: ${error instanceof Error ? error.message : String(error)}`)).finally(() => this.pending.delete(tracked))
    this.pending.add(tracked)
  }
}
