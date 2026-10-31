import { MANUAL_LABELS, type StatusCategory, type TaskMilestone, type TaskStatus } from '../tracker/model.js'

export interface ChainRules {
  active: string[] | null
  terminal: string[] | null
  requiredLabels: string[]
  /** Kept out besides `MANUAL_LABELS`, which no list can let in (BTN-187). */
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

/** The labels that keep a task out: the manual ones and the rules' own. */
export const excludedOf = (rules: ChainRules) => [...MANUAL_LABELS, ...rules.excludedLabels]

/** Closed, or kept out for good by an excluded label: the chain will not take it whatever happens to it. */
export function excludes(rules: ChainRules, task: { status: TaskStatus; labels: string[] }): boolean {
  return isTerminal(rules, task.status) || task.labels.some((label) => listed(excludedOf(rules), label))
}

export function admits(rules: ChainRules, task: { status: TaskStatus; labels: string[] }): boolean {
  if (excludes(rules, task)) return false
  return rules.requiredLabels.length === 0 || task.labels.some((label) => listed(rules.requiredLabels, label))
}

/** The required label "Into the chain" puts on an open task that has none of them (BTN-509); `null` — the task needs none. */
export function missingLabel(rules: ChainRules, task: { status: TaskStatus; labels: string[] }): string | null {
  if (excludes(rules, task) || admits(rules, task)) return null
  return rules.requiredLabels[0]!
}

/** The required labels the task carries, as the tracker spells them: "To the backlog" takes them off. */
export const requiredOn = (rules: ChainRules, task: { labels: string[] }): string[] => task.labels.filter((label) => listed(rules.requiredLabels, label))

export function ownsMilestone(rules: ChainRules, task: { milestone: TaskMilestone | null }): boolean {
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
