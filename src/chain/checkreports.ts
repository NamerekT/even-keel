/** What the check before a merge reported (EKR-103): the tree of the task's branch its commands passed on, and the commands. */
export interface CheckReport {
  tree: string
  commands: string[]
}

/**
 * The reports of the checks before the merge, by project and task, as the `checkpoint` hook sends them. Only a report
 * proves the check ran; in memory, so after a restart a push of main without one is checked in the next task's place.
 */
export class CheckReports {
  private readonly reports = new Map<string, CheckReport>()

  report(project: string, task: string, report: CheckReport): void {
    this.reports.set(`${project}\n${task}`, report)
  }

  of(project: string, task: string): CheckReport | undefined {
    return this.reports.get(`${project}\n${task}`)
  }

  /** The tasks of the project that have a report. */
  tasks(project: string): string[] {
    const prefix = `${project}\n`
    return [...this.reports.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
  }

  /** The project's reports by task: what the hub's brief hands its machine. */
  ofProject(project: string): Record<string, CheckReport> {
    return Object.fromEntries(this.tasks(project).map((task) => [task, this.of(project, task)!]))
  }
}

/** The report in a request's body; `null` — not one. */
export function checkReportOf(body: unknown): CheckReport | null {
  if (typeof body !== 'object' || body === null) return null
  const { tree, commands } = body as Record<string, unknown>
  if (typeof tree !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(tree)) return null
  if (!Array.isArray(commands) || !commands.every((command) => typeof command === 'string')) return null
  return { tree, commands }
}
