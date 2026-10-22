import type { TaskRef, TrackerCard } from '../tracker/card.js'
import { PRIORITIES, type TaskPriority, type TaskStatus, type TrackerTask } from '../tracker/model.js'
import type { TrackerPlace } from '../tracker/source.js'

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

/** An issue a card links to: enough to show its title and status. */
export interface CardRef extends IssueRef {
  title: string
  state: IssueState
  stateReason: IssueStateReason | null
}

export interface GithubCardIssue extends Omit<GithubIssue, 'parent' | 'blockedBy'> {
  body: string | null
  parent: CardRef | null
  blockedBy: { nodes: CardRef[] }
  blocking: { nodes: CardRef[] }
  comments: { nodes: { author: { login: string } | null; createdAt: string; body: string }[] }
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

/**
 * The repositories of the projects, by the project's id and by its key: a task id is made of the key, and projects with
 * one key name one repository (`TrackerProjectKey.placeOf`), so two projects on a repository share their task ids.
 */
export class RepoMap {
  private readonly keys = new Map<string, string>()
  private readonly repos = new Map<string, Repo>()
  private readonly byKey = new Map<string, Repo>()
  private readonly projectKeys = new Map<string, string>()

  constructor(projects: Readonly<Record<string, TrackerPlace>>) {
    for (const [project, { key, value: slug }] of Object.entries(projects)) {
      if (slug === undefined) continue
      const [owner, name] = slug.split('/') as [string, string]
      this.repos.set(project, { owner, name })
      this.projectKeys.set(project, key)
      if (!this.byKey.has(key)) this.byKey.set(key, { owner, name })
      if (!this.keys.has(slug.toLowerCase())) this.keys.set(slug.toLowerCase(), key)
    }
  }

  keyOf(slug: string): string | undefined {
    return this.keys.get(slug.toLowerCase())
  }

  /** The repository of the project by its id. */
  repoOf(project: string): Repo | undefined {
    return this.repos.get(project)
  }

  /** The repository of the tasks whose ids start with `key`. */
  repoOfKey(key: string): Repo | undefined {
    return this.byKey.get(key)
  }

  /** The key the project's task ids are made of. */
  projectKey(project: string): string | undefined {
    return this.projectKeys.get(project)
  }

  idOf(ref: IssueRef): string {
    const key = this.keyOf(ref.repository.nameWithOwner)
    return key === undefined ? `${ref.repository.nameWithOwner}#${ref.number}` : `${key}-${ref.number}`
  }
}

export function toCard(issue: GithubCardIssue, repos: RepoMap): TrackerCard {
  const labels = issue.labels.nodes.map((label) => label.name)
  const { milestone } = issue
  const refOf = (ref: CardRef): TaskRef => ({ id: repos.idOf(ref), title: ref.title, status: githubStatus(ref.state, ref.stateReason) })
  return {
    id: repos.idOf(issue),
    title: issue.title,
    description: issue.body ?? '',
    status: githubStatus(issue.state, issue.stateReason),
    priority: githubPriority(labels),
    labels,
    milestone: milestone === null ? null : { label: milestone.title, targetDate: milestone.dueOn === null ? null : Date.parse(milestone.dueOn) },
    parent: issue.parent === null ? null : refOf(issue.parent),
    blockedBy: issue.blockedBy.nodes.map(refOf),
    blocks: issue.blocking.nodes.map(refOf),
    related: [],
    comments: [...issue.comments.nodes]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((node) => ({ author: node.author?.login ?? null, at: Date.parse(node.createdAt), text: node.body })),
    attachments: [],
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
