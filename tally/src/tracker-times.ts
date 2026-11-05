import type { TimeTracker } from '../../src/stats/tally.js'
import { ADAPTERS } from '../../src/tracker/adapters.js'
import type { TaskSource } from '../../src/tracker/source.js'
import { REPORT_DESCRIPTION, type TimeReport } from './huly.js'

type Log = (message: string) => void
export type ConnectTracker = (tracker: TimeTracker) => Promise<TaskSource>

/** Connects through the adapter of the profile's tracker, as the service's own trackers do. */
export const connectTracker = (timeoutMs: number): ConnectTracker => async (tracker) => {
  const setup = ADAPTERS[tracker.kind]?.setup(tracker.values, tracker.places)
  if (setup === undefined) throw new Error('the profile has no credentials')
  return await setup.connect(timeoutMs)
}

/**
 * The time reports of the tasks of projects on another tracker than Huly (GitLab, Jira; EKR-35), each through the
 * profile its prefix runs on, a tracker connected only for reports of its own. By task the hours written; `null` — the
 * tracker refuses time in the task's project, so the task needs no report. A failure ends that tracker's batch:
 * what was written stays, the rest waits for the next run.
 */
export async function reportTrackerTimes(reports: readonly TimeReport[], trackers: readonly TimeTracker[], log: Log, connect: ConnectTracker): Promise<Map<string, number | null>> {
  const done = new Map<string, number | null>()
  for (const tracker of trackers) {
    const prefixes = new Set(tracker.prefixes)
    const own = reports.filter((report) => prefixes.has(prefixOf(report.task)))
    if (own.length === 0) continue
    const title = ADAPTERS[tracker.kind]?.title ?? tracker.kind
    const refused = new Set<string>()
    let source: TaskSource | undefined
    try {
      source = await connect(tracker)
      for (const report of own) {
        const written = (await source.logTime?.(report.task, { hours: report.hours, at: report.date, summary: REPORT_DESCRIPTION })) ?? false
        done.set(report.task, written ? report.hours : null)
        const prefix = prefixOf(report.task)
        if (written || refused.has(prefix)) continue
        refused.add(prefix)
        log(`tally: ${title} refuses time in ${prefix} (time tracking off, or no right to log work): its tasks get no time report`)
      }
    } catch (error) {
      log(`tally: ${title} time reports of ${tracker.prefixes.join(', ')} not written: ${(error as Error).message}`)
    } finally {
      await source?.close().catch(() => {})
    }
  }
  return done
}

const prefixOf = (task: string): string => task.slice(0, task.lastIndexOf('-'))
