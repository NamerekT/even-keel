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
}

/** The report in a request's body; `null` — not one. */
export function checkReportOf(body: unknown): CheckReport | null {
  if (typeof body !== 'object' || body === null) return null
  const { tree, commands } = body as Record<string, unknown>
  if (typeof tree !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(tree)) return null
  if (!Array.isArray(commands) || !commands.every((command) => typeof command === 'string')) return null
  return { tree, commands }
}
