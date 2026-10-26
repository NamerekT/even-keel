import { sameName } from '../chain/rules.js'
import type { TaskAttachment, TaskRef, TrackerCard } from '../tracker/card.js'
import type { TaskMilestone, TaskPriority, TaskStatus, TrackerTask } from '../tracker/model.js'
import { adfToMarkdown, type AdfNode, type MediaLink } from './adf.js'

export interface JiraStatus {
  id: string
  name: string
  statusCategory: { key: string }
}

export interface JiraRef {
  key: string
  fields: { summary: string; status: JiraStatus }
}

export interface JiraLink {
  type: { name: string }
  /** The issue on the link's inward side: for `Blocks` it blocks this one. */
  inwardIssue?: JiraRef
  outwardIssue?: JiraRef
}

export interface JiraVersion {
  id: string
  name: string
  releaseDate?: string
  released?: boolean
  archived?: boolean
}

export interface JiraAttachment {
  id: string
  filename: string
  mimeType?: string
  size?: number
}

export interface JiraFields {
  summary: string
  status: JiraStatus
  priority?: { id: string; name: string } | null
  labels?: string[]
  fixVersions?: JiraVersion[]
  parent?: JiraRef | null
  issuelinks?: JiraLink[]
  subtasks?: { key: string }[]
  issuetype?: { hierarchyLevel?: number; subtask?: boolean } | null
  description?: AdfNode | null
  attachment?: JiraAttachment[]
}

export interface JiraIssue {
  id: string
  key: string
  fields: JiraFields
}

export interface JiraComment {
  id: string
  author?: { displayName?: string } | null
  created: string
  body?: AdfNode | null
}

/** The fields a task of the chain needs; the card adds the description and the files. */
export const TASK_FIELDS = ['summary', 'status', 'priority', 'labels', 'fixVersions', 'parent', 'issuelinks', 'subtasks', 'issuetype']
export const CARD_FIELDS = [...TASK_FIELDS, 'description', 'attachment']

/** The link type the chain orders by; it is found by this name, so a site that renamed it has no blockers (`jira.blocksType`). */
export const BLOCKS = 'Blocks'
const RELATES = 'Relates'

/**
 * A status by its category: `new` is ready, `indeterminate` in progress, `done` done. Jira has no category of its own
 * for a backlog: Jira Software's backlog column is a `new` status named Backlog, so a `new` status of that name is the
 * backlog and stays out of the chain by default.
 */
export function jiraStatus(status: Pick<JiraStatus, 'name' | 'statusCategory'>): TaskStatus {
  switch (status.statusCategory.key) {
    case 'new':
      return { name: status.name, category: sameName(status.name, 'Backlog') ? 'UnStarted' : 'ToDo' }
    case 'indeterminate':
      return { name: status.name, category: 'Active' }
    case 'done':
      return { name: status.name, category: 'Won' }
    default:
      return { name: status.name, category: 'UnStarted' }
  }
}

const BUILT_IN: Readonly<Record<string, TaskPriority>> = { highest: 'urgent', high: 'high', medium: 'medium', low: 'low', lowest: 'low' }
const LEVELS: readonly TaskPriority[] = ['urgent', 'high', 'medium', 'low']

/** The built-in priorities by name; a site's own scheme by the priority's place in `order`, highest first. */
export function jiraPriority(priority: { name: string } | null | undefined, order: readonly string[]): TaskPriority {
  if (priority == null) return 'none'
  const named = BUILT_IN[priority.name.trim().toLowerCase()]
  if (named !== undefined) return named
  const at = order.findIndex((name) => sameName(name, priority.name))
  if (at < 0) return 'none'
  return order.length === 1 ? 'medium' : LEVELS[Math.round((at * (LEVELS.length - 1)) / (order.length - 1))]!
}

/** The site's priority for a level: the built-in one of its name, else the first whose place gives the level. */
export function priorityFor<T extends { name: string }>(level: TaskPriority, priorities: readonly T[]): T | undefined {
  if (level === 'none') return undefined
  const order = priorities.map((each) => each.name)
  const named = priorities.find((each) => sameName(each.name, level === 'urgent' ? 'Highest' : level))
  return named ?? priorities.find((each) => jiraPriority(each, order) === level)
}

/** The earliest version by release date; one without a date goes after the dated ones. */
export function earliestVersion(versions: readonly JiraVersion[] | undefined): JiraVersion | null {
  const dated = (version: JiraVersion) => (version.releaseDate ? Date.parse(version.releaseDate) : Number.POSITIVE_INFINITY)
  return [...(versions ?? [])].sort((a, b) => dated(a) - dated(b))[0] ?? null
}

export function milestoneOf(version: JiraVersion | null): TaskMilestone | null {
  return version === null ? null : { label: version.name, targetDate: version.releaseDate ? Date.parse(version.releaseDate) : null }
}

const isBlocks = (link: JiraLink) => sameName(link.type.name, BLOCKS)

/** `children` — how many issues have this one as their parent; Jira lists only sub-tasks on the issue itself. */
export function toTrackerTask(issue: JiraIssue, order: readonly string[], children = issue.fields.subtasks?.length ?? 0): TrackerTask {
  const fields = issue.fields
  return {
    id: issue.key,
    title: fields.summary,
    status: jiraStatus(fields.status),
    blockedBy: (fields.issuelinks ?? []).flatMap((link) => (isBlocks(link) && link.inwardIssue !== undefined ? [link.inwardIssue.key] : [])),
    parent: fields.parent?.key ?? null,
    subtasks: children,
    milestone: milestoneOf(earliestVersion(fields.fixVersions)),
    priority: jiraPriority(fields.priority, order),
    labels: fields.labels ?? [],
    estimate: 0,
  }
}

/** An issue that may have children other than its sub-tasks: an epic, or a level above it. */
export const hasChildIssues = (issue: JiraIssue): boolean => (issue.fields.issuetype?.hierarchyLevel ?? 0) > 0

/** The service's route to a file of the task's card, as `cardOf` makes it. */
const fileRoute = (task: string, file: string) => `/api/tasks/${encodeURIComponent(task)}/files/${encodeURIComponent(file)}`

/**
 * A media node names its file by the media id, not by the attachment's: its `alt` is the file name, and the attachment
 * of that name is taken for it.
 */
export function mediaLinks(task: string, attachments: readonly JiraAttachment[]): MediaLink {
  return ({ alt }) => {
    const found = attachments.find((each) => each.filename === alt)
    return found === undefined ? null : { url: fileRoute(task, found.id), image: (found.mimeType ?? '').startsWith('image/') }
  }
}

export function toCard(issue: JiraIssue, comments: readonly JiraComment[], order: readonly string[]): TrackerCard {
  const fields = issue.fields
  const task = toTrackerTask(issue, order)
  const refOf = (ref: JiraRef): TaskRef => ({ id: ref.key, title: ref.fields.summary, status: jiraStatus(ref.fields.status) })
  const links = fields.issuelinks ?? []
  const media = mediaLinks(issue.key, fields.attachment ?? [])
  const attachments: TaskAttachment[] = (fields.attachment ?? []).map((each) => ({ file: each.id, name: each.filename, type: each.mimeType ?? '', size: each.size ?? 0, url: null }))
  return {
    id: issue.key,
    title: fields.summary,
    description: adfToMarkdown(fields.description, media),
    status: task.status,
    priority: task.priority,
    labels: task.labels,
    milestone: task.milestone,
    parent: fields.parent == null ? null : refOf(fields.parent),
    blockedBy: links.flatMap((link) => (isBlocks(link) && link.inwardIssue !== undefined ? [refOf(link.inwardIssue)] : [])),
    blocks: links.flatMap((link) => (isBlocks(link) && link.outwardIssue !== undefined ? [refOf(link.outwardIssue)] : [])),
    related: links.flatMap((link) => (sameName(link.type.name, RELATES) ? [link.inwardIssue ?? link.outwardIssue].filter((ref) => ref !== undefined).map(refOf) : [])),
    comments: [...comments]
      .sort((a, b) => Date.parse(a.created) - Date.parse(b.created))
      .map((comment) => ({ author: comment.author?.displayName ?? null, at: Date.parse(comment.created), text: adfToMarkdown(comment.body, media) })),
    attachments,
  }
}
