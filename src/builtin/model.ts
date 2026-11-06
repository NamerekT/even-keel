import type { TaskPriority, TaskStatus } from '../tracker/model.js'

/** The tracker's name in `ADAPTERS` and in a project's `tracker`. */
export const BUILTIN = 'builtin'

/** The fixed statuses of the built-in tracker (BTN-767), in their order; nothing configures them. */
export const BUILTIN_STATUSES: readonly TaskStatus[] = [
  { name: 'Backlog', category: 'UnStarted' },
  { name: 'Todo', category: 'ToDo' },
  { name: 'In Progress', category: 'Active' },
  { name: 'In Review', category: 'Active' },
  { name: 'Done', category: 'Won' },
  { name: 'Canceled', category: 'Lost' },
  { name: 'Duplicate', category: 'Lost' },
]

export const BACKLOG = BUILTIN_STATUSES[0]!
export const TODO = BUILTIN_STATUSES[1]!
export const DONE = BUILTIN_STATUSES[4]!

/** What Even Keel moves a task into on its start, on its pull request and on its merge: fixed, as the statuses are. */
export const BUILTIN_MOVES = { start: 'In Progress', review: 'In Review', done: 'Done' } as const

export const BUILTIN_PRIORITIES: readonly TaskPriority[] = ['none', 'low', 'medium', 'high', 'urgent']

/** Labels every project has, with a meaning ready: kept out of the chain, a question, a bug, a rework of a done task. */
export const BUILTIN_LABELS = ['Manual', 'Question', 'Bug', 'Rework'] as const

/** Huly's palette has 24 colors; a label's color is picked by its name. */
export const LABEL_COLORS = 24

export type CommentAuthor = 'person' | 'agent' | 'service'
export const COMMENT_AUTHORS: readonly CommentAuthor[] = ['person', 'agent', 'service']

export type RelationKind = 'blocks' | 'relates'

/** The status of this name, ignoring case; `undefined` — the built-in tracker has none such. */
export function builtinStatus(name: string): TaskStatus | undefined {
  const key = name.trim().toLocaleLowerCase()
  return BUILTIN_STATUSES.find((status) => status.name.toLocaleLowerCase() === key)
}

export function labelColor(name: string): number {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return hash % LABEL_COLORS
}

export interface BuiltinMilestone {
  name: string
  /** ms; `null` — no date. */
  date: number | null
}

const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Milestones by date, the undated after them, then by name with numbers compared as numbers (v0.10 after v0.9). */
export function compareBuiltinMilestones(a: BuiltinMilestone, b: BuiltinMilestone): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1
    if (b.date === null) return -1
    return a.date - b.date
  }
  return names.compare(a.name, b.name)
}

/** The first spelling of each name, ignoring case and blanks. */
export function uniqueNames(list: readonly string[]): string[] {
  const seen = new Map<string, string>()
  for (const name of list) {
    const key = name.trim().toLocaleLowerCase()
    if (key !== '' && !seen.has(key)) seen.set(key, name.trim())
  }
  return [...seen.values()]
}
