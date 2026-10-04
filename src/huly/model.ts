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
      parent: issue.parents?.[0]?.identifier ?? null,
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
