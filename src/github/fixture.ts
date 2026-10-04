import type { GithubIssue } from './model.js'

export const issue = (number: number, fields: Partial<GithubIssue> = {}, repo = 'octo-org/abc'): GithubIssue => ({
  id: `I_kwDOexample${number}`,
  number,
  title: `Issue ${number}`,
  state: 'OPEN',
  stateReason: null,
  repository: { nameWithOwner: repo },
  parent: null,
  subIssuesSummary: { total: 0 },
  blockedBy: { nodes: [] },
  labels: { nodes: [] },
  milestone: null,
  ...fields,
})
