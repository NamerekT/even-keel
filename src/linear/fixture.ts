import type { LinearIssue } from './model.js'

export const issue = (identifier: string, fields: Partial<LinearIssue> = {}): LinearIssue => ({
  id: `uuid-${identifier.toLowerCase()}`,
  identifier,
  title: `Issue ${identifier}`,
  priority: 0,
  state: { name: 'Todo', type: 'unstarted' },
  parent: null,
  children: { nodes: [] },
  inverseRelations: { nodes: [] },
  labels: { nodes: [] },
  projectMilestone: null,
  ...fields,
})
