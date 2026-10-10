import type { TaskRef, TrackerCard } from '../tracker/card.js'
import type { StatusCategory, TaskPriority, TaskStatus, TrackerTask } from '../tracker/model.js'

const HULY_PRIORITIES: readonly TaskPriority[] = ['none', 'urgent', 'high', 'medium', 'low']

export interface HulyStatusDoc {
  _id: string
  name: string
  category?: string
}

export interface HulyMilestoneDoc {
  _id: string
  label: string
  targetDate: number
}

export interface HulyIssueDoc {
  _id: string
  identifier: string
  title: string
  status: string
  blockedBy?: { _id: string }[]
  parents?: { identifier: string }[]
  milestone?: string | null
  priority?: number
  subIssues?: number
  labels?: number
  estimation?: number
}

export interface HulyLabelDoc {
  attachedTo: string
  title: string
}

export interface HulyCardIssue extends HulyIssueDoc {
  attachedTo?: string
  relations?: { _id: string; _class: string }[]
}

/** A comment with its text already in Markdown. */
export interface HulyCommentDoc {
  createdBy?: string
  createdOn: number
  text: string
}

export interface HulyCardDocs {
  issue: HulyCardIssue
  description: string
  statuses: HulyStatusDoc[]
  /** The issues the card links to (`cardLinks`) and the ones in `blocks`. */
  linked: HulyIssueDoc[]
  /** The ids of the issues blocked by this one. */
  blocks: string[]
  milestones: HulyMilestoneDoc[]
  labels: HulyLabelDoc[]
  comments: HulyCommentDoc[]
  /** A person's name as Huly keeps it, by social id. */
  people: ReadonlyMap<string, string>
  /** The files of the issue and of its comments. */
  attachments: HulyAttachmentDoc[]
}

/** `file` is the blob id in the workspace storage. */
export interface HulyAttachmentDoc {
  file: string
  name: string
  type?: string
  size?: number
  modifiedOn: number
  createdOn?: number
}

export const ISSUE_CLASS = 'tracker:class:Issue'
const NO_PARENT = 'tracker:ids:NoParent'

const CATEGORY_PREFIX = 'task:statusCategory:'
const CATEGORIES: ReadonlySet<string> = new Set<StatusCategory>(['UnStarted', 'ToDo', 'Active', 'Won', 'Lost'])

export function toStatus(doc: HulyStatusDoc): TaskStatus {
  const category = doc.category?.startsWith(CATEGORY_PREFIX) ? doc.category.slice(CATEGORY_PREFIX.length) : undefined
  if (category === undefined || !CATEGORIES.has(category)) {
    throw new Error(`huly: status "${doc.name}" has unknown category ${String(doc.category)}`)
  }
  return { name: doc.name, category: category as StatusCategory }
}

export function toTasks(
  issues: HulyIssueDoc[],
  statuses: HulyStatusDoc[],
  otherIdentifiers: ReadonlyMap<string, string>,
  milestones: HulyMilestoneDoc[],
  labels: HulyLabelDoc[] = [],
): TrackerTask[] {
  const statusById = new Map(statuses.map((doc) => [doc._id, doc]))
  const labelsById = new Map<string, string[]>()
  for (const doc of labels) labelsById.set(doc.attachedTo, [...(labelsById.get(doc.attachedTo) ?? []), doc.title])
  const milestoneById = new Map(milestones.map((doc) => [doc._id, { label: doc.label, targetDate: doc.targetDate }]))
  const identifierById = new Map(otherIdentifiers)
  for (const issue of issues) identifierById.set(issue._id, issue.identifier)

  return issues.map((issue) => {
    const status = statusById.get(issue.status)
    if (status === undefined) throw new Error(`huly: ${issue.identifier} has unknown status ${issue.status}`)
    return {
      id: issue.identifier,
      title: issue.title,
      status: toStatus(status),
      blockedBy: (issue.blockedBy ?? []).flatMap((ref) => identifierById.get(ref._id) ?? []),
      parent: issue.parents?.at(-1)?.identifier ?? null,
      subtasks: issue.subIssues ?? 0,
      milestone: issue.milestone ? (milestoneById.get(issue.milestone) ?? null) : null,
      priority: HULY_PRIORITIES[issue.priority ?? 0] ?? 'none',
      labels: labelsById.get(issue._id) ?? [],
      estimate: issue.estimation ? issue.estimation : null,
    }
  })
}

// `allowed` — the statuses of the project's type in their order; `null` when the type is unknown.
export function closingStatus(current: string, statuses: HulyStatusDoc[], allowed: string[] | null): string | null {
  const byId = new Map(statuses.map((doc) => [doc._id, doc]))
  const now = byId.get(current)
  if (now !== undefined && ['Won', 'Lost'].includes(toStatus(now).category)) return null
  const candidates = allowed === null ? statuses : allowed.flatMap((id) => byId.get(id) ?? [])
  const won = candidates.find((doc) => toStatus(doc).category === 'Won')
  if (won === undefined) throw new Error('huly: the project has no done status')
  return won._id
}

// `allowed` as in `closingStatus`. `null` — the issue is past the backlog.
export function readyStatus(current: string, statuses: HulyStatusDoc[], allowed: string[] | null): HulyStatusDoc | null {
  const byId = new Map(statuses.map((doc) => [doc._id, doc]))
  const now = byId.get(current)
  if (now === undefined || toStatus(now).category !== 'UnStarted') return null
  const candidates = allowed === null ? statuses : allowed.flatMap((id) => byId.get(id) ?? [])
  const ready = candidates.find((doc) => toStatus(doc).category === 'ToDo')
  if (ready === undefined) throw new Error('huly: the project has no ToDo status')
  return ready
}

// Huly keeps a person's name as "Last,First".
export function personName(name: string): string {
  const [last = '', first = ''] = name.split(',')
  return `${first.trim()} ${last.trim()}`.trim()
}

/** The ids of the issues a card links to by the issue itself: its parent, blockers and related issues. */
export function cardLinks(issue: HulyCardIssue): string[] {
  const parent = issue.attachedTo !== undefined && issue.attachedTo !== NO_PARENT ? [issue.attachedTo] : []
  const related = (issue.relations ?? []).filter((ref) => ref._class === ISSUE_CLASS).map((ref) => ref._id)
  return [...new Set([...parent, ...(issue.blockedBy ?? []).map((ref) => ref._id), ...related])]
}

export function toCard(docs: HulyCardDocs): TrackerCard {
  const { issue, statuses } = docs
  const statusById = new Map(statuses.map((doc) => [doc._id, doc]))
  const statusOf = (doc: HulyIssueDoc): TaskStatus => {
    const status = statusById.get(doc.status)
    if (status === undefined) throw new Error(`huly: ${doc.identifier} has unknown status ${doc.status}`)
    return toStatus(status)
  }
  const linked = new Map(docs.linked.map((doc) => [doc._id, { id: doc.identifier, title: doc.title, status: statusOf(doc) }]))
  const refs = (ids: string[]): TaskRef[] => ids.flatMap((id) => linked.get(id) ?? [])
  const milestone = issue.milestone ? docs.milestones.find((doc) => doc._id === issue.milestone) : undefined

  return {
    id: issue.identifier,
    title: issue.title,
    description: docs.description,
    status: statusOf(issue),
    priority: HULY_PRIORITIES[issue.priority ?? 0] ?? 'none',
    labels: docs.labels.filter((doc) => doc.attachedTo === issue._id).map((doc) => doc.title),
    milestone: milestone === undefined ? null : { label: milestone.label, targetDate: milestone.targetDate },
    parent: issue.attachedTo === undefined ? null : (linked.get(issue.attachedTo) ?? null),
    blockedBy: refs((issue.blockedBy ?? []).map((ref) => ref._id)),
    blocks: refs(docs.blocks),
    related: refs((issue.relations ?? []).filter((ref) => ref._class === ISSUE_CLASS).map((ref) => ref._id)),
    comments: [...docs.comments]
      .sort((a, b) => a.createdOn - b.createdOn)
      .map((doc) => {
        const name = doc.createdBy === undefined ? undefined : docs.people.get(doc.createdBy)
        return { author: name === undefined ? null : personName(name), at: doc.createdOn, text: doc.text }
      }),
    attachments: [...docs.attachments]
      .sort((a, b) => (a.createdOn ?? a.modifiedOn) - (b.createdOn ?? b.modifiedOn))
      .map((doc) => ({ file: doc.file, name: doc.name, type: doc.type ?? '', size: doc.size ?? 0, url: null })),
  }
}

export function missingBlockers(issues: HulyIssueDoc[]): string[] {
  const fetched = new Set(issues.map((issue) => issue._id))
  const missing = new Set<string>()
  for (const issue of issues) {
    for (const ref of issue.blockedBy ?? []) if (!fetched.has(ref._id)) missing.add(ref._id)
  }
  return [...missing]
}

export function milestonesOf(issues: HulyIssueDoc[]): string[] {
  return [...new Set(issues.flatMap((issue) => issue.milestone ?? []))]
}

export function labeled(issues: HulyIssueDoc[]): string[] {
  return issues.filter((issue) => (issue.labels ?? 0) > 0).map((issue) => issue._id)
}
