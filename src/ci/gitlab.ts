import { getJson, getJsonPage } from './http.js'
import { isFinished, type CiJob, type CiRun, type CiSource, type RunStatus } from './model.js'

interface GitlabSettings {
  web: string
  owner: string
  repo: string
  token: string
}

interface Pipeline {
  id: number
  iid: number
  name: string | null
  ref: string
  sha: string
  status: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  web_url: string
}

interface Job {
  id: number
  name: string
  status: string
  started_at: string | null
  finished_at: string | null
}

const STATUSES: Readonly<Record<string, RunStatus>> = {
  created: 'queued', pending: 'queued', scheduled: 'queued', waiting_for_resource: 'queued', waiting_for_callback: 'queued',
  preparing: 'running', running: 'running', canceling: 'running',
  success: 'success', failed: 'failure', canceled: 'cancelled', skipped: 'skipped', manual: 'skipped',
}
const statusOf = (status: string): RunStatus => STATUSES[status] ?? 'queued'
const TITLE = 'GitLab CI'

export function gitlabSource(settings: GitlabSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): CiSource {
  const base = `${settings.web}/api/v4/projects/${encodeURIComponent(`${settings.owner}/${settings.repo}`)}`
  const auth = `Bearer ${settings.token}`
  const get = <T>(path: string) => getJson<T>(TITLE, `${base}${path}`, auth, timeoutMs, fetchImpl)
  return {
    async runs(limit, branch) {
      const filter = branch === undefined ? '' : `&ref=${encodeURIComponent(branch)}`
      const listed = await get<Pipeline[]>(`/pipelines?per_page=${limit}&page=1&order_by=id&sort=desc${filter}`)
      return Promise.all(listed.map(async ({ id }): Promise<CiRun> => {
        // The project pipeline list omits timing; the detail endpoint supplies it on older GitLab versions too.
        const run = await get<Pipeline>(`/pipelines/${id}`)
        const status = statusOf(run.status)
        return {
          id: run.id, number: run.iid, title: run.name || run.ref, workflow: run.name || TITLE, commit: run.sha, status,
          createdAt: run.created_at, startedAt: status === 'queued' ? null : run.started_at ?? null,
          stoppedAt: isFinished(status) ? run.finished_at ?? null : null, url: run.web_url,
        }
      }))
    },
    async jobs(run) {
      const jobs: Job[] = []
      let page: string | null = '1'
      const seen = new Set<string>()
      while (page !== null && page !== '') {
        if (!/^[1-9]\d*$/.test(page) || seen.has(page)) throw new Error('gitlab: invalid CI pagination')
        seen.add(page)
        const result: { rows: Job[]; nextPage: string | null } = await getJsonPage<Job>(TITLE, `${base}/pipelines/${run.id}/jobs?per_page=100&page=${page}`, auth, timeoutMs, fetchImpl)
        jobs.push(...result.rows)
        page = result.nextPage ?? (result.rows.length === 100 ? String(Number(page) + 1) : null)
      }
      return jobs.map((job): CiJob => ({
        id: job.id, name: job.name, status: statusOf(job.status), startedAt: job.started_at, stoppedAt: job.finished_at, steps: null,
      }))
    },
  }
}
