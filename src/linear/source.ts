import { commentsAfterId, linkedFiles } from '../tracker/comments.js'
import { parseTaskId, type TaskPriority, type TrackerTask } from '../tracker/model.js'
import type { TaskSource } from '../tracker/source.js'
import { linearStatus, toTrackerTask, type LinearIssue, type LinearState } from './model.js'

export interface LinearSettings {
  token: string
  /** The Linear project a project key narrows its team down to, by name. */
  projects: Readonly<Record<string, string>>
}

export interface LinearSource extends TaskSource {
  /** The workspace part of the issue links: `https://linear.app/<urlKey>/issue/ENG-1`. */
  urlKey: string
}

interface Connection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: T[]
}

interface TeamState extends LinearState {
  id: string
}

type IssueFilter = Record<string, unknown>

const API = 'https://api.linear.app/graphql'
const PAGE = 50
const BY_ID_CHUNK = 50
const CLOSED_TYPES = new Set(['completed', 'canceled', 'duplicate'])

// Linear rejects a query whose estimated complexity is over 10000, and a list without `first` counts as 50.
const ISSUE = `id identifier title priority
  state { name type }
  parent { identifier }
  children(first: 25) { nodes { id } }
  inverseRelations(first: 25) { nodes { type issue { identifier } } }
  labels(first: 25) { nodes { name } }
  projectMilestone { id name targetDate }`

const TEAM = `query($team: String!) {
  team(id: $team) { id states(first: 100) { nodes { id name type } } }
}`

const TEAM_PROJECT = `query($team: String!, $project: String!) {
  team(id: $team) {
    id states(first: 100) { nodes { id name type } }
    projects(first: 1, filter: { name: { eqIgnoreCase: $project } }) { nodes { id } }
  }
}`

const ISSUES = `query($filter: IssueFilter!, $after: String) {
  issues(first: ${PAGE}, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE} } }
}`

const ISSUE_BRIEF = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) { nodes { title description } }
}`

const ISSUE_STATE = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) {
    nodes { id state { type } team { states(first: 20, filter: { type: { eq: "completed" } }) { nodes { id position } } } }
  }
}`

const MOVE_ISSUE = `mutation($id: String!, $state: String!) {
  issueUpdate(id: $id, input: { stateId: $state }) { success }
}`

const ISSUE_ID = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) { nodes { id } }
}`

const ISSUE_COMMENTS = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) { nodes { comments(first: 100) { nodes { id body createdAt } } } }
}`

const ADD_COMMENT = `mutation($id: String!, $body: String!) {
  commentCreate(input: { issueId: $id, body: $body }) { success comment { id } }
}`

const ISSUE_PLACE = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) { nodes { project { id } projectMilestone { id } } }
}`

const CREATE_ISSUE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier } }
}`

const LINEAR_PRIORITY: Readonly<Record<TaskPriority, number>> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }

/** Where Linear keeps uploaded files; they need the key like the API does. */
const UPLOADS = /^https:\/\/uploads\.linear\.app\//

export async function connectLinear(settings: LinearSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<LinearSource> {
  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetchImpl(API, {
      method: 'POST',
      headers: { authorization: settings.token, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json().catch(() => ({}))) as { data?: T | null; errors?: { message: string }[] }
    const errors = (body.errors ?? []).map((error) => error.message).join('; ')
    if (!response.ok) throw new Error(`linear: HTTP ${response.status}${errors ? `: ${errors}` : ''}`)
    if (errors || body.data == null) throw new Error(`linear: ${errors || 'empty answer'}`)
    return body.data
  }

  async function collect(filter: IssueFilter): Promise<LinearIssue[]> {
    const issues: LinearIssue[] = []
    let after: string | null = null
    do {
      const { issues: connection }: { issues: Connection<LinearIssue> } = await graphql(ISSUES, { filter, after })
      issues.push(...connection.nodes)
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    } while (after !== null)
    return issues
  }

  async function teamOf(key: string): Promise<{ id: string; states: TeamState[]; project?: string }> {
    const project = settings.projects[key]
    type Team = { id: string; states: { nodes: TeamState[] }; projects?: { nodes: { id: string }[] } }
    let team: Team | null
    try {
      ;({ team } = await graphql<{ team: Team | null }>(project === undefined ? TEAM : TEAM_PROJECT, project === undefined ? { team: key } : { team: key, project }))
    } catch (error) {
      throw new Error(`linear: team ${key}: ${(error as Error).message.replace(/^linear: /, '')}`)
    }
    if (team === null) throw new Error(`linear: team ${key} not found or the key cannot see it`)
    if (project === undefined) return { id: team.id, states: team.states.nodes }
    const found = team.projects?.nodes[0]
    if (found === undefined) throw new Error(`linear: team ${key} has no project "${project}"`)
    return { id: team.id, states: team.states.nodes, project: found.id }
  }

  function byNumber(id: string): IssueFilter {
    const parsed = parseTaskId(id)
    if (parsed === null) throw new Error(`linear: ${id} is not a task id`)
    return { team: { key: { eq: parsed.project } }, number: { eq: parsed.number } }
  }

  async function oneIssue<T>(id: string, query: string): Promise<T> {
    const { issues } = await graphql<{ issues: { nodes: T[] } }>(query, { filter: byNumber(id) })
    const issue = issues.nodes[0]
    if (issue === undefined) throw new Error(`linear: issue ${id} not found or the key cannot see it`)
    return issue
  }

  const { organization } = await graphql<{ organization: { urlKey: string } }>('query { organization { urlKey } }')

  return {
    urlKey: organization.urlKey,

    async chainTasks(key, open) {
      const team = await teamOf(key)
      const statesWhere = (wanted: boolean) => team.states.filter((state) => open(linearStatus(state)) === wanted).map((state) => state.id)
      const scope: IssueFilter = { team: { id: { eq: team.id } } }
      const openIssues = await collect({ ...scope, state: { id: { in: statesWhere(true) } }, ...(team.project === undefined ? {} : { project: { id: { eq: team.project } } }) })
      const milestones = [...new Set(openIssues.filter((issue) => issue.children.nodes.length === 0).flatMap((issue) => (issue.projectMilestone === null ? [] : [issue.projectMilestone.id])))]
      const closedStates = statesWhere(false)
      const closedIssues = milestones.length === 0 || closedStates.length === 0 ? [] : await collect({ ...scope, state: { id: { in: closedStates } }, projectMilestone: { id: { in: milestones } } })
      return { tasks: [...openIssues, ...closedIssues].map(toTrackerTask), statuses: team.states.map((state) => state.name) }
    },

    async tasks(ids) {
      const numbers = new Map<string, Set<number>>()
      for (const id of ids) {
        const parsed = parseTaskId(id)
        if (parsed === null) continue
        numbers.set(parsed.project, (numbers.get(parsed.project) ?? new Set()).add(parsed.number))
      }
      const filters = [...numbers].flatMap(([key, wanted]) => {
        const list = [...wanted]
        return Array.from({ length: Math.ceil(list.length / BY_ID_CHUNK) }, (_, index) => ({
          team: { key: { eq: key } },
          number: { in: list.slice(index * BY_ID_CHUNK, (index + 1) * BY_ID_CHUNK) },
        }))
      })
      if (filters.length === 0) return []
      const params = filters.map((_, index) => `$f${index}: IssueFilter!`).join(', ')
      const parts = filters.map((_, index) => `t${index}: issues(first: ${BY_ID_CHUNK}, filter: $f${index}) { nodes { ${ISSUE} } }`)
      const data = await graphql<Record<string, { nodes: LinearIssue[] }>>(
        `query(${params}) {\n${parts.join('\n')}\n}`,
        Object.fromEntries(filters.map((filter, index) => [`f${index}`, filter])),
      )
      return Object.values(data).flatMap((connection): TrackerTask[] => connection.nodes.map(toTrackerTask))
    },

    async brief(id) {
      const issue = await oneIssue<{ title: string; description: string | null }>(id, ISSUE_BRIEF)
      return { title: issue.title, description: issue.description ?? '' }
    },

    async complete(id) {
      const issue = await oneIssue<{ id: string; state: { type: string }; team: { states: { nodes: { id: string; position: number }[] } } }>(id, ISSUE_STATE)
      if (CLOSED_TYPES.has(issue.state.type)) return false
      const done = [...issue.team.states.nodes].sort((a, b) => a.position - b.position)[0]
      if (done === undefined) throw new Error(`linear: the team of ${id} has no completed state`)
      const { issueUpdate } = await graphql<{ issueUpdate: { success: boolean } }>(MOVE_ISSUE, { id: issue.id, state: done.id })
      if (!issueUpdate.success) throw new Error(`linear: ${id} was not moved to ${done.id}`)
      return true
    },

    async comment(id, body) {
      const issue = await oneIssue<{ id: string }>(id, ISSUE_ID)
      const { commentCreate } = await graphql<{ commentCreate: { success: boolean; comment: { id: string } | null } }>(ADD_COMMENT, { id: issue.id, body })
      if (!commentCreate.success || commentCreate.comment === null) throw new Error(`linear: the comment on ${id} was not created`)
      return commentCreate.comment.id
    },

    async commentsAfter(id, after) {
      const issue = await oneIssue<{ comments: { nodes: { id: string; body: string; createdAt: string }[] } }>(id, ISSUE_COMMENTS)
      const comments = [...issue.comments.nodes]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map((node) => ({ id: node.id, body: node.body, files: linkedFiles(node.body, UPLOADS) }))
      return commentsAfterId(comments, after)
    },

    // The ready status is the team's first `unstarted` state; the project and the milestone are those of `milestoneOf`.
    async create(task) {
      const team = await teamOf(task.project)
      const state = team.states.find((each) => each.type === 'unstarted')
      if (state === undefined) throw new Error(`linear: team ${task.project} has no unstarted state`)
      const place =
        task.milestoneOf === null
          ? null
          : (await graphql<{ issues: { nodes: { project: { id: string } | null; projectMilestone: { id: string } | null }[] } }>(ISSUE_PLACE, { filter: byNumber(task.milestoneOf) })).issues.nodes[0] ?? null
      const project = place?.project?.id ?? team.project
      const input = {
        teamId: team.id,
        title: task.title,
        description: task.description,
        priority: LINEAR_PRIORITY[task.priority],
        stateId: state.id,
        ...(project === undefined ? {} : { projectId: project }),
        ...(place?.projectMilestone == null ? {} : { projectMilestoneId: place.projectMilestone.id }),
      }
      const { issueCreate } = await graphql<{ issueCreate: { success: boolean; issue: { identifier: string } | null } }>(CREATE_ISSUE, { input })
      if (!issueCreate.success || issueCreate.issue === null) throw new Error(`linear: the issue in ${task.project} was not created`)
      return issueCreate.issue.identifier
    },

    // A file of a comment is its upload link; the key goes only to Linear's upload host.
    async file(_id, file) {
      if (!UPLOADS.test(file)) return null
      const response = await fetchImpl(file, { headers: { authorization: settings.token }, signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok || response.body === null) return null
      const size = Number.parseInt(response.headers.get('content-length') ?? '', 10)
      return { type: response.headers.get('content-type') ?? '', size: Number.isNaN(size) ? null : size, body: response.body }
    },

    close: async () => {},
  }
}
