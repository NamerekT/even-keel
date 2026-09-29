export type StatusCategory = 'UnStarted' | 'ToDo' | 'Active' | 'Won' | 'Lost'

export interface TaskStatus {
  name: string
  category: StatusCategory
}

export interface TaskMilestone {
  label: string
  targetDate: number
}

export interface HulyTask {
  id: string
  title: string
  status: TaskStatus
  blockedBy: string[]
  milestone: TaskMilestone | null
  question: boolean
  models: ModelAlias[]
}

export const MODEL_ALIASES = ['sonnet', 'opus', 'haiku'] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(value: string): value is ModelAlias {
  return (MODEL_ALIASES as readonly string[]).includes(value)
}

export interface StatusChange {
  id: string
  from: TaskStatus | null
  to: TaskStatus | null
}

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
  milestone?: string | null
  subIssues?: number
  labels?: number
}

export interface HulyLabelDoc {
  attachedTo: string
  title: string
}

export const QUESTION_LABEL = 'Вопрос'

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
): HulyTask[] {
  const statusById = new Map(statuses.map((doc) => [doc._id, doc]))
  const question = QUESTION_LABEL.toLocaleLowerCase()
  const questions = new Set<string>()
  const modelsById = new Map<string, Set<ModelAlias>>()
  for (const doc of labels) {
    const title = doc.title.trim().toLocaleLowerCase()
    if (title === question) questions.add(doc.attachedTo)
    if (!isModelAlias(title)) continue
    const models = modelsById.get(doc.attachedTo) ?? new Set()
    modelsById.set(doc.attachedTo, models.add(title))
  }
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
      milestone: issue.milestone ? (milestoneById.get(issue.milestone) ?? null) : null,
      question: questions.has(issue._id),
      models: MODEL_ALIASES.filter((model) => modelsById.get(issue._id)?.has(model)),
    }
  })
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

export function withoutParents(issues: HulyIssueDoc[]): HulyIssueDoc[] {
  return issues.filter((issue) => (issue.subIssues ?? 0) === 0)
}

export function isOpen(status: TaskStatus): boolean {
  return status.category !== 'Won' && status.category !== 'Lost'
}

export function diffStatuses(
  known: ReadonlyMap<string, TaskStatus>,
  current: HulyTask[],
  watched: string[],
): StatusChange[] {
  const now = new Map(current.map((task) => [task.id, task.status]))
  const changes: StatusChange[] = []
  for (const id of watched) {
    const from = known.get(id) ?? null
    const to = now.get(id) ?? null
    if (from?.name === to?.name && from?.category === to?.category) continue
    changes.push({ id, from, to })
  }
  return changes
}
