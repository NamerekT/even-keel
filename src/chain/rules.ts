import type { StatusCategory, TaskStatus } from '../tracker/model.js'

export interface ChainRules {
  active: string[] | null
  terminal: string[] | null
  requiredLabels: string[]
  excludedLabels: string[]
}

export const DEFAULT_RULES: ChainRules = { active: null, terminal: null, requiredLabels: [], excludedLabels: ['Manual', 'Вручную'] }

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

export function admits(rules: ChainRules, task: { status: TaskStatus; labels: string[] }): boolean {
  if (excludes(rules, task)) return false
  return rules.requiredLabels.length === 0 || task.labels.some((label) => listed(rules.requiredLabels, label))
}

export function unknownStatuses(rules: ChainRules, known: string[]): string[] {
  const names = [...(rules.active ?? []), ...(rules.terminal ?? [])]
  const unknown = new Map<string, string>()
  for (const name of names) if (!listed(known, name) && !unknown.has(normal(name))) unknown.set(normal(name), name.trim())
  return [...unknown.values()]
}
