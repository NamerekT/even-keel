import { PRIORITIES, type TaskPriority, type TaskStatus, type TrackerTask } from '../tracker/model.js'

export type IssueState = 'OPEN' | 'CLOSED'
export type IssueStateReason = 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED'

export interface IssueRef {
  number: number
  repository: { nameWithOwner: string }
}

export interface GithubIssue extends IssueRef {
  id: string
  title: string
  state: IssueState
  stateReason: IssueStateReason | null
  parent: IssueRef | null
  subIssuesSummary: { total: number }
  blockedBy: { nodes: IssueRef[] }
  labels: { nodes: { name: string }[] }
  milestone: { number: number; title: string; dueOn: string | null } | null
}

export interface Repo {
  owner: string
  name: string
}

const OPEN: TaskStatus = { name: 'Open', category: 'ToDo' }
const COMPLETED: TaskStatus = { name: 'Completed', category: 'Won' }
const NOT_PLANNED: TaskStatus = { name: 'Not planned', category: 'Lost' }
const DUPLICATE: TaskStatus = { name: 'Duplicate', category: 'Lost' }

export const GITHUB_STATUSES: readonly TaskStatus[] = [OPEN, COMPLETED, NOT_PLANNED, DUPLICATE]

const PRIORITY_LABEL = /^priority\s*[:/]\s*(\w+)$/i

export function githubStatus(state: IssueState, reason: IssueStateReason | null): TaskStatus {
  if (state === 'OPEN') return OPEN
  if (reason === 'NOT_PLANNED') return NOT_PLANNED
  if (reason === 'DUPLICATE') return DUPLICATE
  return COMPLETED
}

export function githubPriority(labels: string[]): TaskPriority {
  const levels = labels.flatMap((label) => {
    const level = PRIORITY_LABEL.exec(label.trim())?.[1]?.toLowerCase()
    const index = (PRIORITIES as readonly string[]).indexOf(level ?? 'none')
    return index >= 0 && level !== 'none' ? [index] : []
  })
  return levels.length === 0 ? 'none' : PRIORITIES[Math.min(...levels)]!
}

export class RepoMap {
  private readonly keys = new Map<string, string>()
  private readonly repos = new Map<string, Repo>()

  constructor(projects: Readonly<Record<string, string>>) {
    for (const [key, slug] of Object.entries(projects)) {
      const [owner, name] = slug.split('/') as [string, string]
      this.repos.set(key, { owner, name })
      if (!this.keys.has(slug.toLowerCase())) this.keys.set(slug.toLowerCase(), key)
    }
  }

  keyOf(slug: string): string | undefined {
    return this.keys.get(slug.toLowerCase())
  }

  repoOf(project: string): Repo | undefined {
    return this.repos.get(project)
  }

  idOf(ref: IssueRef): string {
    const key = this.keyOf(ref.repository.nameWithOwner)
    return key === undefined ? `${ref.repository.nameWithOwner}#${ref.number}` : `${key}-${ref.number}`
  }
}

export function toTrackerTask(issue: GithubIssue, repos: RepoMap): TrackerTask {
  const labels = issue.labels.nodes.map((label) => label.name)
  const { milestone } = issue
  return {
    id: repos.idOf(issue),
    title: issue.title,
    status: githubStatus(issue.state, issue.stateReason),
    blockedBy: issue.blockedBy.nodes.map((ref) => repos.idOf(ref)),
    parent: issue.parent === null ? null : repos.idOf(issue.parent),
    subtasks: issue.subIssuesSummary.total,
    milestone: milestone === null ? null : { label: milestone.title, targetDate: milestone.dueOn === null ? null : Date.parse(milestone.dueOn) },
    priority: githubPriority(labels),
    labels,
    estimate: 0,
  }
}
