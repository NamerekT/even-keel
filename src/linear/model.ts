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

export function linearStatus(state: LinearState): TaskStatus {
  return { name: state.name, category: CATEGORIES[state.type] ?? 'UnStarted' }
}

export function linearPriority(priority: number): TaskPriority {
  return PRIORITIES[priority] ?? 'none'
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
