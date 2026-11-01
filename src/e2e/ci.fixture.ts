import type { CiJob, CiRun, CiSource, RunStatus } from '../ci/model.js'
import { runGit } from '../git/run.js'

/** What a run of a pushed commit comes out as; `null` — the CI takes no run of it at all. */
export type Outcome = Extract<RunStatus, 'success' | 'failure' | 'queued' | 'running'> | null

/**
 * A CI on the bench's remote: the first poll after a push to a branch of the bare repository finds a run of its head,
 * and `outcome` decides by the commit's subject how it comes out. A failed run has one failed job with `log`.
 */
export class Ci {
  readonly runs: CiRun[] = []
  /** By the subject of the pushed head commit, or the commit itself; every push is green unless the scenario says otherwise. */
  outcome: (subject: string, commit: string) => Outcome = () => 'success'
  /** The log of a failed job, as the CI's API gives it. */
  log = 'npm test\nFAIL src/sum.test.ts\nAssertionError: expected 3 to be 4\n'
  /** How many times the service asked for the runs. */
  polls = 0
  private readonly seen = new Set<string>()
  /** The branch each run is of, by its id. */
  private readonly branches = new Map<number, string>()

  constructor(private readonly remote: () => string) {}

  /** The run of the commit whose subject holds `subject`, newest first. */
  runOf(subject: string): CiRun | undefined {
    return this.runs.find((run) => run.title.includes(subject))
  }

  /** A run under way or queued ends as `status`. */
  finish(subject: string, status: RunStatus): void {
    const run = this.runOf(subject)
    if (run === undefined) throw new Error(`ci: no run of "${subject}"`)
    const at = new Date().toISOString()
    Object.assign(run, { status, startedAt: run.startedAt ?? at, stoppedAt: at })
  }

  /** The adapter to put into `CI_SOURCES`: every project and token reads this CI. */
  source(): CiSource {
    return {
      runs: async (limit, branch) => {
        this.polls++
        await this.look(branch ?? 'main')
        return this.runs.filter((run) => branch === undefined || this.branches.get(run.id) === branch).slice(0, limit).map((run) => ({ ...run }))
      },
      jobs: async (run) => [this.job(this.runs.find((each) => each.id === run.id) ?? run)],
      log: async () => this.log,
    }
  }

  private job(run: CiRun): CiJob {
    return { id: run.id, name: 'test', status: run.status, startedAt: run.startedAt, stoppedAt: run.stoppedAt, steps: null }
  }

  private async look(branch: string): Promise<void> {
    const head = await runGit(this.remote(), ['log', '-1', '--format=%H%x00%s', branch])
    if (head.code !== 0) return
    const [commit, subject] = head.out.trim().split('\0') as [string, string]
    if (this.seen.has(commit)) return
    this.seen.add(commit)
    const status = this.outcome(subject, commit)
    if (status === null) return
    const id = this.runs.length + 1
    const at = new Date().toISOString()
    this.branches.set(id, branch)
    const finished = status === 'success' || status === 'failure'
    this.runs.unshift({
      id,
      number: id,
      title: subject,
      workflow: 'ci',
      commit,
      status,
      createdAt: at,
      startedAt: status === 'queued' ? null : at,
      stoppedAt: finished ? at : null,
      url: `${FORGE_WEB}/john/example/actions/runs/${id}`,
    })
  }
}

/** The web address of the bench's forge: nothing listens there, git reaches the bare repository through `insteadOf`. */
export const FORGE_WEB = 'http://127.0.0.1:9'
