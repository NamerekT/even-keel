import { getJson } from './http.js'
import { isFinished, type CiJob, type CiRun, type CiSource, type RunStatus } from './model.js'

export interface ForgejoSettings {
  web: string
  owner: string
  repo: string
  token: string
}

interface ForgejoRun {
  id: number
  index_in_repo: number
  title: string
  workflow_id: string
  commit_sha: string
  status: string
  created: string
  started: string
  stopped: string
  html_url: string
}

interface ForgejoJob {
  id: number
  name: string
  status: string
  task_id: number
}

interface ForgejoTask {
  id: number
  run_started_at: string
  updated_at: string
}

const TITLE = 'Forgejo'
// The latest tasks of the repository, enough to cover the jobs of a recent run.
const TASKS = 50

const STATUSES: Record<string, RunStatus> = {
  running: 'running',
  success: 'success',
  failure: 'failure',
  cancelled: 'cancelled',
  skipped: 'skipped',
}

const statusOf = (status: string): RunStatus => STATUSES[status] ?? 'queued'

/** Forgejo writes an unset time as the zero time of Go or of Unix. */
const timeOf = (value: string | undefined): string | null => (value === undefined || value === '' || Date.parse(value) <= 0 ? null : value)

// The API of Forgejo 16 gives runs and their jobs, but no steps: those stay on the run's page. A job's times
// come from its task. `limit` without `page` is ignored and the whole history comes back, so `page` always goes.
export function forgejoSource(settings: ForgejoSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): CiSource {
  const base = `${settings.web}/api/v1/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`
  const get = <T>(path: string) => getJson<T>(TITLE, `${base}${path}`, `token ${settings.token}`, timeoutMs, fetchImpl)

  return {
    async runs(limit, branch) {
      const filter = branch === undefined ? '' : `&ref=${encodeURIComponent(`refs/heads/${branch}`)}`
      const { workflow_runs: runs } = await get<{ workflow_runs: ForgejoRun[] | null }>(`/actions/runs?page=1&limit=${limit}${filter}`)
      return (runs ?? []).map(
        (run): CiRun => ({
          id: run.id,
          number: run.index_in_repo,
          title: run.title,
          workflow: run.workflow_id,
          commit: run.commit_sha,
          status: statusOf(run.status),
          createdAt: run.created,
          startedAt: timeOf(run.started),
          stoppedAt: timeOf(run.stopped),
          url: run.html_url,
        }),
      )
    },

    async jobs(run) {
      const [jobs, tasks] = await Promise.all([
        get<ForgejoJob[] | null>(`/actions/runs/${run.id}/jobs`),
        get<{ workflow_runs: ForgejoTask[] | null }>(`/actions/tasks?page=1&limit=${TASKS}`),
      ])
      const byId = new Map((tasks.workflow_runs ?? []).map((task) => [task.id, task]))
      return (jobs ?? []).map((job): CiJob => {
        const status = statusOf(job.status)
        const task = job.task_id > 0 ? byId.get(job.task_id) : undefined
        return {
          id: job.id,
          name: job.name,
          status,
          startedAt: timeOf(task?.run_started_at),
          stoppedAt: isFinished(status) ? timeOf(task?.updated_at) : null,
          steps: null,
        }
      })
    },
  }
}
