import { commentsAfterId, linkedFiles } from '../tracker/comments.js'
import { trackedFetch } from '../tracker/diagnostics.js'
import { resolveLabels, type NamedLabel } from '../tracker/labels.js'
import { parseTaskId, type TaskPriority, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound, type TaskSource, type TrackerPlace } from '../tracker/source.js'
import { linearPlace, linearStatus, readyState, toCard, toTrackerTask, type LinearCardIssue, type LinearIssue, type LinearState, type TeamStateDoc } from './model.js'

export interface LinearSettings {
  token: string
  /** The place of each project by its id: its key and its `linear` value, a project of the team by name (`linearPlace`). */
  projects: Readonly<Record<string, TrackerPlace>>
}

export interface LinearSource extends TaskSource {
  /** The workspace part of the issue links: `https://linear.app/<urlKey>/issue/ENG-1`. */
  urlKey: string
  /** The page of each Linear project a project narrows its team to, by the project's id, once its tasks were read. */
  projectUrls: ReadonlyMap<string, string>
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
    projects(first: 1, filter: { name: { eqIgnoreCase: $project } }) { nodes { id url } }
  }
}`

const ISSUES = `query($filter: IssueFilter!, $after: String) {
  issues(first: ${PAGE}, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE} } }
}`

// Linear archives closed issues after a while; a parent counts those children too.
const CHILDREN = `query($filter: IssueFilter!, $after: String) {
  issues(first: ${PAGE}, after: $after, filter: $filter, includeArchived: true) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE} } }
}`

// Which end of `comments` is the newest is not checked live: both ends are taken and compared.
const MILESTONE_ISSUES = `query($filter: IssueFilter!, $after: String) {
  issues(first: ${PAGE}, after: $after, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ISSUE} oldest: comments(first: 1) { nodes { body createdAt } } newest: comments(last: 1) { nodes { body createdAt } } }
  }
}`

type CommentNode = { body: string; createdAt: string }
type MilestoneIssue = LinearIssue & { oldest: { nodes: CommentNode[] }; newest: { nodes: CommentNode[] } }

const ISSUE_BRIEF = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) { nodes { title description } }
}`

const ISSUE_STATE = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) {
    nodes { id state { type } team { states(first: 20, filter: { type: { eq: "completed" } }) { nodes { id position } } } }
  }
}`

const CARD_REF = 'identifier title state { name type }'

const ISSUE_CARD = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) {
    nodes {
      identifier title description priority
      state { name type }
      parent { ${CARD_REF} }
      relations(first: 25) { nodes { type relatedIssue { ${CARD_REF} } } }
      inverseRelations(first: 25) { nodes { type issue { ${CARD_REF} } } }
      labels(first: 25) { nodes { name } }
      projectMilestone { name targetDate }
      comments(first: 100) { nodes { user { name } createdAt body } }
    }
  }
}`

const ISSUE_READY = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) {
    nodes { id state { name type } team { states(first: 100) { nodes { id name type position } } } }
  }
}`

const MOVE_ISSUE =`mutation($id: String!, $state: String!) {
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
  issues(first: 1, filter: $filter) { nodes { id project { id } projectMilestone { id } } }
}`

const MILESTONE_CHOICES = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) { nodes { projectMilestone { id } project { projectMilestones(first: 100) { nodes { id name targetDate } } } } }
}`

const PLACE_ISSUE = `mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`

// A workspace label has no team. A group only gathers labels and cannot go on an issue itself.
const TEAM_LABELS = `query($team: ID!, $after: String) {
  issueLabels(first: ${PAGE}, after: $after, filter: { or: [{ team: { id: { eq: $team } } }, { team: { null: true } }] }) {
    pageInfo { hasNextPage endCursor } nodes { id name isGroup }
  }
}`

const CREATE_ISSUE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier } }
}`

const LINEAR_PRIORITY: Readonly<Record<TaskPriority, number>> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }

/** Where Linear keeps uploaded files; they need the key like the API does. */
const UPLOADS = /^https:\/\/uploads\.linear\.app\//

export async function connectLinear(settings: LinearSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<LinearSource> {
  const projectUrls = new Map<string, string>()

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await trackedFetch(fetchImpl, API, {
      method: 'POST',
      headers: { authorization: settings.token, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    }, '/graphql')
    const body = (await response.json().catch(() => ({}))) as { data?: T | null; errors?: { message: string }[] }
    const errors = (body.errors ?? []).map((error) => error.message).join('; ')
    if (!response.ok) throw new Error(`linear: HTTP ${response.status}${errors ? `: ${errors}` : ''}`)
    if (errors || body.data == null) throw new Error(`linear: ${errors || 'empty answer'}`)
    return body.data
  }

  async function collect<T extends LinearIssue = LinearIssue>(filter: IssueFilter, query = ISSUES): Promise<T[]> {
    const issues: T[] = []
    let after: string | null = null
    do {
      const { issues: connection }: { issues: Connection<T> } = await graphql(query, { filter, after })
      issues.push(...connection.nodes)
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    } while (after !== null)
    return issues
  }

  /** The team and the Linear project of an Even Keel project; one missing from `projects` is taken for a team key. */
  const placeOf = (key: string) => {
    const place = settings.projects[key]
    return place === undefined ? linearPlace(key, undefined) : linearPlace(place.key, place.value)
  }

  async function teamOf(key: string): Promise<{ id: string; states: TeamState[]; project?: string }> {
    const { team: teamKey, project } = placeOf(key)
    type Team = { id: string; states: { nodes: TeamState[] }; projects?: { nodes: { id: string; url: string }[] } }
    let team: Team | null
    try {
      ;({ team } = await graphql<{ team: Team | null }>(project === null ? TEAM : TEAM_PROJECT, project === null ? { team: teamKey } : { team: teamKey, project }))
    } catch (error) {
      throw new Error(`linear: team ${teamKey}: ${(error as Error).message.replace(/^linear: /, '')}`)
    }
    if (team === null) throw new TrackerNotFound(`linear: team ${teamKey} not found or the key cannot see it`)
    if (project === null) return { id: team.id, states: team.states.nodes }
    const found = team.projects?.nodes[0]
    if (found === undefined) throw new Error(`linear: team ${teamKey} has no project "${project}"`)
    projectUrls.set(key, `${found.url}/issues`)
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
    if (issue === undefined) throw new TrackerNotFound(`linear: issue ${id} not found or the key cannot see it`)
    return issue
  }

  const { organization } = await graphql<{ organization: { urlKey: string } }>('query { organization { urlKey } }')

  return {
    urlKey: organization.urlKey,
    projectUrls,

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

    async card(id) {
      return toCard(await oneIssue<LinearCardIssue>(id, ISSUE_CARD))
    },

    async children(id) {
      return (await collect({ parent: byNumber(id) }, CHILDREN)).map(toTrackerTask)
    },

    async ready(id) {
      const issue = await oneIssue<{ id: string; state: LinearState; team: { states: { nodes: TeamStateDoc[] } } }>(id, ISSUE_READY)
      const state = readyState(issue.state, issue.team.states.nodes)
      if (state === null) return null
      const { issueUpdate } = await graphql<{ issueUpdate: { success: boolean } }>(MOVE_ISSUE, { id: issue.id, state: state.id })
      if (!issueUpdate.success) throw new Error(`linear: ${id} was not moved to ${state.id}`)
      return linearStatus(state)
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
      if (state === undefined) throw new Error(`linear: team ${placeOf(task.project).team} has no unstarted state`)
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
      if (!issueCreate.success || issueCreate.issue === null) throw new Error(`linear: the issue in ${placeOf(task.project).team} was not created`)
      return issueCreate.issue.identifier
    },

    // A milestone belongs to a project: an issue without a project gets it with the milestone, an issue of another project is left alone.
    async setMilestone(id, milestoneOf) {
      type Place = { id: string; project: { id: string } | null; projectMilestone: { id: string } | null }
      const issue = await oneIssue<Place>(id, ISSUE_PLACE)
      if (issue.projectMilestone !== null) return false
      const like = await oneIssue<Place>(milestoneOf, ISSUE_PLACE)
      if (like.project === null || like.projectMilestone === null) return false
      if (issue.project !== null && issue.project.id !== like.project.id) return false
      const input = { ...(issue.project === null ? { projectId: like.project.id } : {}), projectMilestoneId: like.projectMilestone.id }
      const { issueUpdate } = await graphql<{ issueUpdate: { success: boolean } }>(PLACE_ISSUE, { id: issue.id, input })
      if (!issueUpdate.success) throw new Error(`linear: ${id} was not put into the milestone of ${milestoneOf}`)
      return true
    },

    // Linear's milestones have no closed state: all of the project's are offered.
    async milestones(id) {
      type Choice = { id: string; name: string; targetDate: string | null }
      const issue = await oneIssue<{ projectMilestone: { id: string } | null; project: { projectMilestones: { nodes: Choice[] } } | null }>(id, MILESTONE_CHOICES)
      return {
        current: issue.projectMilestone?.id ?? null,
        choices: (issue.project?.projectMilestones.nodes ?? []).map((each) => ({
          id: each.id,
          label: each.name,
          targetDate: each.targetDate === null ? null : Date.parse(each.targetDate),
        })),
      }
    },

    async moveMilestone(id, milestone) {
      const issue = await oneIssue<{ id: string }>(id, ISSUE_ID)
      const { issueUpdate } = await graphql<{ issueUpdate: { success: boolean } }>(PLACE_ISSUE, { id: issue.id, input: { projectMilestoneId: milestone } })
      if (!issueUpdate.success) throw new Error(`linear: the milestone of ${id} was not changed`)
    },

    async milestoneTasks(key, milestone) {
      const team = await teamOf(key)
      const filter: IssueFilter = {
        team: { id: { eq: team.id } },
        projectMilestone: { name: { eq: milestone } },
        ...(team.project === undefined ? {} : { project: { id: { eq: team.project } } }),
      }
      const issues = await collect<MilestoneIssue>(filter, MILESTONE_ISSUES)
      return issues.map((issue) => ({ ...toTrackerTask(issue), lastComment: newestBody([...issue.oldest.nodes, ...issue.newest.nodes]) }))
    },

    async vocabulary(key) {
      const team = await teamOf(key)
      const labels = new Set<string>()
      let after: string | null = null
      do {
        const { issueLabels }: { issueLabels: Connection<{ name: string; isGroup: boolean }> } = await graphql(TEAM_LABELS, { team: team.id, after })
        for (const label of issueLabels.nodes) if (!label.isGroup) labels.add(label.name)
        after = issueLabels.pageInfo.hasNextPage ? issueLabels.pageInfo.endCursor : null
      } while (after !== null)
      return { statuses: team.states.map(linearStatus), labels: [...labels] }
    },

    async relabel(id, change) {
      type Labeled = { id: string; team: { id: string }; labels: Connection<NamedLabel> }
      const query = `query($filter: IssueFilter!, $after: String) { issues(filter: $filter, first: 1) {
        nodes { id team { id } labels(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id name } } }
      } }`
      const issue = await oneIssue<Labeled>(id, query)
      const current = [...issue.labels.nodes]
      let after = issue.labels.pageInfo.hasNextPage ? issue.labels.pageInfo.endCursor : null
      while (after !== null) {
        const page = await graphql<{ issues: { nodes: Labeled[] } }>(query, { filter: byNumber(id), after })
        const labels = page.issues.nodes[0]!.labels
        current.push(...labels.nodes)
        after = labels.pageInfo.hasNextPage ? labels.pageInfo.endCursor : null
      }
      const catalog: NamedLabel[] = []
      do {
        const page: { issueLabels: Connection<NamedLabel & { isGroup: boolean }> } = await graphql(TEAM_LABELS, { team: issue.team.id, after })
        catalog.push(...page.issueLabels.nodes.filter((label) => !label.isGroup))
        after = page.issueLabels.pageInfo.hasNextPage ? page.issueLabels.pageInfo.endCursor : null
      } while (after !== null)
      const selected = await resolveLabels(current, change, catalog, async (name) => {
        const result = await graphql<{ issueLabelCreate: { success: boolean; issueLabel: NamedLabel } }>(`mutation($input: IssueLabelCreateInput!) {
          issueLabelCreate(input: $input) { success issueLabel { id name } }
        }`, { input: { name, teamId: issue.team.id } })
        if (!result.issueLabelCreate.success) throw new Error('linear: label creation refused')
        return result.issueLabelCreate.issueLabel
      })
      const result = await graphql<{ issueUpdate: { success: boolean; issue: { labels: Connection<NamedLabel> } } }>(`mutation($id: String!, $labels: [String!]!) {
        issueUpdate(id: $id, input: { labelIds: $labels }) { success issue { labels(first: 100) { pageInfo { hasNextPage endCursor } nodes { name } } } }
      }`, { id: issue.id, labels: selected.map((label) => label.id) })
      if (!result.issueUpdate.success) throw new Error('linear: label update refused')
      const saved = [...result.issueUpdate.issue.labels.nodes]
      after = result.issueUpdate.issue.labels.pageInfo.hasNextPage ? result.issueUpdate.issue.labels.pageInfo.endCursor : null
      while (after !== null) {
        const page: { issues: { nodes: Labeled[] } } = await graphql(query, { filter: byNumber(id), after })
        const labels = page.issues.nodes[0]!.labels
        saved.push(...labels.nodes)
        after = labels.pageInfo.hasNextPage ? labels.pageInfo.endCursor : null
      }
      return saved.map((label) => label.name)
    },

    // A file of a comment is its upload link; the key goes only to Linear's upload host.
    async file(_id, file) {
      if (!UPLOADS.test(file)) return null
      const response = await trackedFetch(fetchImpl, file, { headers: { authorization: settings.token }, signal: AbortSignal.timeout(timeoutMs) }, '/uploads/[redacted]')
      if (!response.ok || response.body === null) return null
      const size = Number.parseInt(response.headers.get('content-length') ?? '', 10)
      return { type: response.headers.get('content-type') ?? '', size: Number.isNaN(size) ? null : size, body: response.body }
    },

    close: async () => {},
  }
}

function newestBody(comments: CommentNode[]): string | null {
  const newest = comments.reduce<CommentNode | null>((kept, each) => (kept === null || Date.parse(each.createdAt) > Date.parse(kept.createdAt) ? each : kept), null)
  return newest?.body ?? null
}
