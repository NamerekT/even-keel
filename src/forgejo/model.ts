import { RepoMap } from '../github/model.js'
import type { TaskRef, TrackerCard } from '../tracker/card.js'
import { PRIORITIES, type TaskMilestone, type TaskPriority, type TaskStatus, type TrackerTask } from '../tracker/model.js'

export interface ForgejoMilestone {
  id: number
  title: string
  due_on: string | null
  state: 'open' | 'closed'
}

export interface ForgejoLabel {
  id: number
  name: string
}

/** An issue as the API gives it, also inside `/dependencies` and `/blocks`. */
export interface ForgejoIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: ForgejoLabel[] | null
  milestone: ForgejoMilestone | null
  repository: { owner: string; name: string; full_name: string }
  /** Set on a pull request: the issues endpoints list them too unless asked for `type=issues`. */
  pull_request?: unknown
}

export interface ForgejoComment {
  id: number
  body: string
  created_at: string
  user: { login: string } | null
}

const OPEN: TaskStatus = { name: 'Open', category: 'ToDo' }
const CLOSED: TaskStatus = { name: 'Closed', category: 'Won' }

/** Forgejo keeps no reason for a close, so a closed issue is done: there is no `Lost`. */
export const FORGEJO_STATUSES: readonly TaskStatus[] = [OPEN, CLOSED]
export const forgejoStatus = (state: ForgejoIssue['state']): TaskStatus => (state === 'closed' ? CLOSED : OPEN)

/** `priority: high`, `priority/high` or the exclusive scoped `priority::high`; the highest wins. */
const PRIORITY_LABEL = /^priority\s*(?:::|[:/])\s*(\w+)$/i

export function forgejoPriority(labels: string[]): TaskPriority {
  const levels = labels.flatMap((label) => {
    const level = PRIORITY_LABEL.exec(label.trim())?.[1]?.toLowerCase()
    const index = (PRIORITIES as readonly string[]).indexOf(level ?? 'none')
    return index >= 0 && level !== 'none' ? [index] : []
  })
  return levels.length === 0 ? 'none' : PRIORITIES[Math.min(...levels)]!
}

export const labelNames = (issue: Pick<ForgejoIssue, 'labels'>): string[] => (issue.labels ?? []).map((label) => label.name)

export const milestoneOf = (milestone: ForgejoMilestone | null): TaskMilestone | null =>
  milestone === null ? null : { label: milestone.title, targetDate: milestone.due_on === null ? null : Date.parse(milestone.due_on) }

/** The id of an issue: `<KEY>-<number>` in a project's repository, `owner/name#number` elsewhere. */
export const idOf = (repos: RepoMap, issue: Pick<ForgejoIssue, 'number' | 'repository'>): string =>
  repos.idOf({ number: issue.number, repository: { nameWithOwner: issue.repository.full_name } })

export function toTrackerTask(issue: ForgejoIssue, blockedBy: ForgejoIssue[], repos: RepoMap): TrackerTask {
  const labels = labelNames(issue)
  return {
    id: idOf(repos, issue),
    title: issue.title,
    status: forgejoStatus(issue.state),
    blockedBy: blockedBy.map((each) => idOf(repos, each)),
    parent: null,
    subtasks: 0,
    milestone: milestoneOf(issue.milestone),
    priority: forgejoPriority(labels),
    labels,
    estimate: 0,
  }
}

/** The card; no attachments: a file is a link in the text, as on GitHub. No subtasks in Forgejo, no "related" links. */
export function toCard(issue: ForgejoIssue, blockedBy: ForgejoIssue[], blocks: ForgejoIssue[], comments: ForgejoComment[], repos: RepoMap): TrackerCard {
  const task = toTrackerTask(issue, blockedBy, repos)
  const refOf = (ref: ForgejoIssue): TaskRef => ({ id: idOf(repos, ref), title: ref.title, status: forgejoStatus(ref.state) })
  return {
    id: task.id,
    title: task.title,
    description: issue.body ?? '',
    status: task.status,
    priority: task.priority,
    labels: task.labels,
    milestone: task.milestone,
    parent: null,
    blockedBy: blockedBy.map(refOf),
    blocks: blocks.map(refOf),
    related: [],
    comments: [...comments]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
      .map((comment) => ({ author: comment.user?.login ?? null, at: Date.parse(comment.created_at), text: comment.body })),
    attachments: [],
  }
}
