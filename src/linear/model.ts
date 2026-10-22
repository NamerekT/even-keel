import type { TaskRef, TrackerCard } from '../tracker/card.js'
import type { StatusCategory, TaskPriority, TaskStatus, TrackerTask } from '../tracker/model.js'

export interface LinearState {
  name: string
  type: string
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  priority: number
  state: LinearState
  parent: { identifier: string } | null
  children: { nodes: { id: string }[] }
  inverseRelations: { nodes: { type: string; issue: { identifier: string } }[] }
  labels: { nodes: { name: string }[] }
  projectMilestone: { id: string; name: string; targetDate: string | null } | null
}

export interface LinearRef {
  identifier: string
  title: string
  state: LinearState
}

export interface LinearCardIssue {
  identifier: string
  title: string
  description: string | null
  priority: number
  state: LinearState
  parent: LinearRef | null
  relations: { nodes: { type: string; relatedIssue: LinearRef }[] }
  inverseRelations: { nodes: { type: string; issue: LinearRef }[] }
  labels: { nodes: { name: string }[] }
  projectMilestone: { name: string; targetDate: string | null } | null
  comments: { nodes: { user: { name: string } | null; createdAt: string; body: string }[] }
}

export interface TeamStateDoc extends LinearState {
  id: string
  position: number
}

const CATEGORIES: Readonly<Record<string, StatusCategory>> = {
  triage: 'UnStarted',
  backlog: 'UnStarted',
  unstarted: 'ToDo',
  started: 'Active',
  completed: 'Won',
  canceled: 'Lost',
  duplicate: 'Lost',
}

const PRIORITIES: Readonly<Record<number, TaskPriority>> = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' }

/** A value that names its team before a slash: `NAM/GameStore`, or `NAM/` for the whole team. */
const TEAM_VALUE = /^([A-Z][A-Z0-9_]{0,6})\/(.*)$/

/**
 * The team and the project of the team an Even Keel project reads, from its key and its `linear` value. Without a team
 * in the value the key is the team, as before BTN-172; with one the key is only Even Keel's, so two projects of Even Keel
 * may read one team (BTN-73): the task ids stay the team's, `NAM-12`.
 */
export function linearPlace(key: string, value: string | undefined): { team: string; project: string | null } {
  const text = value?.trim() ?? ''
  const named = TEAM_VALUE.exec(text)
  if (named !== null) return { team: named[1]!, project: named[2]!.trim() || null }
  return { team: key, project: text || null }
}

export function linearStatus(state: LinearState): TaskStatus {
  return { name: state.name, category: CATEGORIES[state.type] ?? 'UnStarted' }
}

export function linearPriority(priority: number): TaskPriority {
  return PRIORITIES[priority] ?? 'none'
}

/** `blocks` relations go both ways: `relations` are the ones this issue starts, `inverseRelations` the ones that point at it. */
export function toCard(issue: LinearCardIssue): TrackerCard {
  const refOf = (ref: LinearRef): TaskRef => ({ id: ref.identifier, title: ref.title, status: linearStatus(ref.state) })
  const unique = (refs: TaskRef[]) => [...new Map(refs.map((ref) => [ref.id, ref])).values()]
  const milestone = issue.projectMilestone
  return {
    id: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    status: linearStatus(issue.state),
    priority: linearPriority(issue.priority),
    labels: issue.labels.nodes.map((label) => label.name),
    milestone: milestone === null ? null : { label: milestone.name, targetDate: milestone.targetDate === null ? null : Date.parse(milestone.targetDate) },
    parent: issue.parent === null ? null : refOf(issue.parent),
    blockedBy: unique(issue.inverseRelations.nodes.filter((relation) => relation.type === 'blocks').map((relation) => refOf(relation.issue))),
    blocks: unique(issue.relations.nodes.filter((relation) => relation.type === 'blocks').map((relation) => refOf(relation.relatedIssue))),
    related: unique([
      ...issue.relations.nodes.filter((relation) => relation.type === 'related').map((relation) => refOf(relation.relatedIssue)),
      ...issue.inverseRelations.nodes.filter((relation) => relation.type === 'related').map((relation) => refOf(relation.issue)),
    ]),
    comments: [...issue.comments.nodes]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((node) => ({ author: node.user?.name ?? null, at: Date.parse(node.createdAt), text: node.body })),
    attachments: [],
  }
}

/** The team's first `unstarted` state by position for a task in a `backlog` state; `null` — the task is not in the backlog. */
export function readyState(current: LinearState, states: TeamStateDoc[]): TeamStateDoc | null {
  if (current.type !== 'backlog') return null
  const ready = states.filter((state) => state.type === 'unstarted').sort((a, b) => a.position - b.position)[0]
  if (ready === undefined) throw new Error('linear: the team has no unstarted state')
  return ready
}

export function toTrackerTask(issue: LinearIssue): TrackerTask {
  const milestone = issue.projectMilestone
  return {
    id: issue.identifier,
    title: issue.title,
    status: linearStatus(issue.state),
    blockedBy: issue.inverseRelations.nodes.filter((relation) => relation.type === 'blocks').map((relation) => relation.issue.identifier),
    parent: issue.parent?.identifier ?? null,
    subtasks: issue.children.nodes.length,
    milestone: milestone === null ? null : { label: milestone.name, targetDate: milestone.targetDate === null ? null : Date.parse(milestone.targetDate) },
    priority: linearPriority(issue.priority),
    labels: issue.labels.nodes.map((label) => label.name),
    estimate: 0,
  }
}
