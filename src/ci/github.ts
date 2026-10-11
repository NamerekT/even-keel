import { getJson } from './http.js'
import type { CiJob, CiRun, CiSource, CiStep, RunStatus } from './model.js'

export interface GithubActionsSettings {
  owner: string
  repo: string
  token: string
}

interface GithubRun {
  id: number
  name: string
  display_title: string
  head_sha: string
  status: string
  conclusion: string | null
  run_number: number
  created_at: string
  run_started_at: string | null
  updated_at: string
  html_url: string
}

interface GithubStep {
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
}

interface GithubJob extends GithubStep {
  id: number
  steps?: GithubStep[]
}

const TITLE = 'GitHub Actions'
const API = 'https://api.github.com'

const CONCLUSIONS: Record<string, RunStatus> = {
  success: 'success',
  neutral: 'success',
  cancelled: 'cancelled',
  stale: 'cancelled',
  skipped: 'skipped',
}

function statusOf(status: string, conclusion: string | null): RunStatus {
  if (status === 'in_progress') return 'running'
  if (status !== 'completed') return 'queued'
  return CONCLUSIONS[conclusion ?? ''] ?? 'failure'
}

function stepOf(step: GithubStep): CiStep {
  return { name: step.name, status: statusOf(step.status, step.conclusion), startedAt: step.started_at, stoppedAt: step.completed_at }
}

export function githubActionsSource(settings: GithubActionsSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): CiSource {
  const base = `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`
  const get = <T>(path: string) => getJson<T>(TITLE, `${base}${path}`, `Bearer ${settings.token}`, timeoutMs, fetchImpl)

  return {
    async runs(limit) {
      const { workflow_runs: runs } = await get<{ workflow_runs: GithubRun[] }>(`/actions/runs?per_page=${limit}`)
      return runs.map((run): CiRun => {
        const status = statusOf(run.status, run.conclusion)
        // GitHub sets `run_started_at` at creation, before a runner takes the run.
        return {
          id: run.id,
          number: run.run_number,
          title: run.display_title,
          workflow: run.name,
          commit: run.head_sha,
          status,
          createdAt: run.created_at,
          startedAt: status === 'queued' ? null : run.run_started_at,
          stoppedAt: run.status === 'completed' ? run.updated_at : null,
          url: run.html_url,
        }
      })
    },

    async jobs(run) {
      const { jobs } = await get<{ jobs: GithubJob[] }>(`/actions/runs/${run.id}/jobs?per_page=100`)
      return jobs.map((job): CiJob => ({ id: job.id, ...stepOf(job), steps: (job.steps ?? []).map(stepOf) }))
    },
  }
}
