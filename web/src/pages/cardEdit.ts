import { ownsMilestone, type ChainRules } from '../../../src/chain/rules.js'
import { notice, type Notice } from '../../../src/notice/notice.js'
import type { BuiltinField } from '../../../src/notice/en.js'
import type { SubtaskRef, TaskRef } from '../../../src/tracker/card.js'
import type { TaskStatus } from '../../../src/tracker/model.js'

/** How a card links its task to another: the first two are one `blocks` relation seen from each end. */
export type LinkKind = 'blocks' | 'blockedBy' | 'relates'

/** What a status pick on the card does: the chain's own moves where there is one, so the card adds no path of its own. */
export type StatusRoute = 'ready' | 'unready' | 'edit'

export function statusRoute(from: TaskStatus, to: TaskStatus): StatusRoute {
  if (from.category === 'UnStarted' && to.category === 'ToDo') return 'ready'
  if ((from.category === 'ToDo' || from.category === 'Active') && to.category === 'UnStarted') return 'unready'
  return 'edit'
}

export const isClosed = (status: TaskStatus): boolean => status.category === 'Won' || status.category === 'Lost'

interface Linked {
  id: string
  blockedBy: TaskRef[]
  blocks: TaskRef[]
  related: TaskRef[]
}

/** Why the card refuses the link before asking the service: the task itself, or a link it already has. */
export function linkRefusal(card: Linked, kind: LinkKind, other: string): Notice | null {
  if (other === card.id) return notice('builtin.selfLink', { task: card.id })
  const held = kind === 'blocks' ? card.blocks : kind === 'blockedBy' ? card.blockedBy : card.related
  return held.some((ref) => ref.id === other) ? notice('builtin.linkExists', { task: card.id, other }) : null
}

/** The service's link command: "blocked by" is the other task blocking this one. */
export function linkBody(task: string, kind: LinkKind, other: string): { task: string; other: string; kind: 'blocks' | 'relates' } {
  if (kind === 'blockedBy') return { task: other, other: task, kind: 'blocks' }
  return { task, other, kind }
}

/** Why the task cannot take this parent, as far as the card sees: itself or one of its direct subtasks. */
export function parentRefusal(task: string, subtasks: readonly TaskRef[], parent: string): Notice | null {
  if (parent === task) return notice('builtin.selfParent', { task })
  return subtasks.some((child) => child.id === parent) ? notice('builtin.parentCycle', { task, parent }) : null
}

/** Subtasks in the chain's order; those it does not hold (closed, in the backlog) after them, by number. */
export function chainOrdered(subtasks: readonly SubtaskRef[], order: readonly string[]): SubtaskRef[] {
  const place = (id: string) => {
    const index = order.indexOf(id)
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  const number = (id: string) => Number(id.slice(id.lastIndexOf('-') + 1))
  return [...subtasks].sort((a, b) => place(a.id) - place(b.id) || number(a.id) - number(b.id))
}

export interface LabelOffer {
  name: string
  /** One Even Keel gives a meaning (Question, Bug, Rework). */
  builtin: boolean
  /** Not a label of the project yet: picking it creates it. */
  create: boolean
}

/** The labels the field offers: those the task does not have, and a new one by the typed name when none is called so. */
export function labelOffers(known: readonly { name: string; builtin: boolean }[], held: readonly string[], typed: string): LabelOffer[] {
  const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
  const free = known.filter((label) => !held.some((name) => same(name, label.name))).map((label) => ({ ...label, create: false }))
  const name = typed.trim()
  if (name === '' || known.some((label) => same(label.name, name)) || held.some((each) => same(each, name))) return free
  return [...free, { name, builtin: false, create: true }]
}

/** The milestone's tasks are not the project's by its "Project tasks": the chain will not take a task put there. */
export function foreignMilestone(rules: Pick<ChainRules, 'requiredMilestones' | 'excludedMilestones'>, name: string): boolean {
  return !ownsMilestone(rules, { milestone: { label: name, targetDate: null } })
}

/** The open subtasks whose milestone a change of the parent's carries along. */
export function carriedSubtasks(subtasks: readonly SubtaskRef[], to: string | null): SubtaskRef[] {
  return subtasks.filter((child) => !isClosed(child.status) && (child.milestone ?? null)?.toLocaleLowerCase() !== to?.toLocaleLowerCase())
}

export interface Conflict {
  field: BuiltinField
  /** What the field holds by now. */
  theirs: string | null
  /** What the person set. */
  mine: string | null
}

/** A refused edit that is a real conflict: the same field changed otherwise meanwhile. Any other refusal is `null`. */
export function conflictOf(failure: Notice | null, mine: string | null): Conflict | null {
  if (failure?.code !== 'builtin.conflict') return null
  return { field: failure.params.field, theirs: failure.params.current, mine }
}

/** Why the card's menu cannot delete the task now (invariant 1): the chain holds it, or a session of it is live. */
export function removeRefusal(task: string, current: boolean, live: boolean): Notice | null {
  if (current) return notice('builtin.removeBusy', { task, why: 'current' })
  return live ? notice('builtin.removeBusy', { task, why: 'live' }) : null
}
