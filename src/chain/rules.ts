import { type StatusCategory, type TaskMilestone, type TaskStatus } from '../tracker/model.js'

export interface ChainRules {
  active: string[] | null
  terminal: string[] | null
  requiredLabels: string[]
  /** Kept out; none by default: no label is built in (BTN-758, BTN-971). */
  excludedLabels: string[]
  /**
   * Split the tasks of one tracker project between Even Keel projects (BTN-172): a project takes only tasks in one of the
   * required milestones, if any are named, and never one in an excluded milestone. Unlike labels, a task left out by them
   * is not the project's at all: it is not read, shown or closed.
   */
  requiredMilestones: string[]
  excludedMilestones: string[]
}

export const DEFAULT_RULES: ChainRules = { active: null, terminal: null, requiredLabels: [], excludedLabels: [], requiredMilestones: [], excludedMilestones: [] }

const ACTIVE_CATEGORIES: readonly StatusCategory[] = ['ToDo', 'Active']
const TERMINAL_CATEGORIES: readonly StatusCategory[] = ['Won', 'Lost']

const normal = (text: string) => text.trim().toLocaleLowerCase()
export const sameName = (a: string, b: string) => normal(a) === normal(b)
const listed = (names: string[], name: string) => names.some((each) => sameName(each, name))

export function isTerminal(rules: ChainRules, status: TaskStatus): boolean {
  return rules.terminal === null ? TERMINAL_CATEGORIES.includes(status.category) : listed(rules.terminal, status.name)
}

export function isActive(rules: ChainRules, status: TaskStatus): boolean {
  if (isTerminal(rules, status)) return false
  return rules.active === null ? ACTIVE_CATEGORIES.includes(status.category) : listed(rules.active, status.name)
}

export function isDone(rules: ChainRules, status: TaskStatus): boolean {
  return status.category === 'Won' && isTerminal(rules, status)
}

/** Closed, or kept out for good by an excluded label: the chain will not take it whatever happens to it. */
export function excludes(rules: ChainRules, task: { status: TaskStatus; labels: string[] }): boolean {
  return isTerminal(rules, task.status) || task.labels.some((label) => listed(rules.excludedLabels, label))
}

/**
 * The label "Into the chain" puts on an outsider's task where the rules require none (BTN-1123): anyone can open an
 * issue in a public repository, so it waits in the backlog until a person lets it in.
 */
export const APPROVAL_LABEL = 'even-keel: approved'

/** What the entry rules read of a task: `outsider` — opened by someone who is not one of the repository's own people. */
export interface EntryTask {
  labels: string[]
  outsider?: true
}

/** The labels of which the task needs one to enter the chain: the required ones, or for an outsider's task without them, the approval label. */
export function entryLabels(rules: ChainRules, task: Pick<EntryTask, 'outsider'>): string[] {
  if (rules.requiredLabels.length > 0) return rules.requiredLabels
  return task.outsider === true ? [APPROVAL_LABEL] : []
}

export function admits(rules: ChainRules, task: EntryTask & { status: TaskStatus }): boolean {
  if (excludes(rules, task)) return false
  const entry = entryLabels(rules, task)
  return entry.length === 0 || task.labels.some((label) => listed(entry, label))
}

/** The entry label "Into the chain" puts on an open task that has none of them (BTN-509); `null` — the task needs none. */
export function missingLabel(rules: ChainRules, task: EntryTask & { status: TaskStatus }): string | null {
  if (excludes(rules, task) || admits(rules, task)) return null
  return entryLabels(rules, task)[0]!
}

/** The entry labels the task carries, as the tracker spells them: "To the backlog" takes them off. */
export const requiredOn = (rules: ChainRules, task: EntryTask): string[] => task.labels.filter((label) => listed(entryLabels(rules, task), label))

export function ownsMilestone(rules: Pick<ChainRules, 'requiredMilestones' | 'excludedMilestones'>, task: { milestone: TaskMilestone | null }): boolean {
  const name = task.milestone?.label
  if (name !== undefined && listed(rules.excludedMilestones, name)) return false
  return rules.requiredMilestones.length === 0 || (name !== undefined && listed(rules.requiredMilestones, name))
}

/** No task, with a milestone or without one, is owned by both: two projects on one tracker project need it. */
export function splitsMilestones(a: ChainRules, b: ChainRules): boolean {
  const named = a.requiredMilestones.length > 0 ? a.requiredMilestones : b.requiredMilestones
  if (named.length === 0) return false
  const owned = (label: string) => ownsMilestone(a, { milestone: { label, targetDate: null } }) && ownsMilestone(b, { milestone: { label, targetDate: null } })
  return !named.some(owned)
}

export function unknownStatuses(rules: ChainRules, known: string[]): string[] {
  const names = [...(rules.active ?? []), ...(rules.terminal ?? [])]
  const unknown = new Map<string, string>()
  for (const name of names) if (!listed(known, name) && !unknown.has(normal(name))) unknown.set(normal(name), name.trim())
  return [...unknown.values()]
}
