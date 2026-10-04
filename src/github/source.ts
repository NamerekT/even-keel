import { parseTaskId, type TaskStatus, type TrackerTask } from '../tracker/model.js'
import type { TaskSource } from '../tracker/source.js'
import { GITHUB_STATUSES, githubStatus, RepoMap, toTrackerTask, type GithubIssue, type IssueState, type Repo } from './model.js'

export interface GithubSettings {
  token: string
  projects: Readonly<Record<string, string>>
}

interface GraphqlError {
  type?: string
  message: string
}

interface Connection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: T[]
}

const API = 'https://api.github.com/graphql'
const PAGE = 100

const ISSUE = `id number title state stateReason
  repository { nameWithOwner }
  parent { number repository { nameWithOwner } }
  subIssuesSummary { total }
  blockedBy(first: 50) { nodes { number repository { nameWithOwner } } }
  labels(first: 50) { nodes { name } }
  milestone { number title dueOn }`

const REPOSITORY_ISSUES = `query($owner: String!, $name: String!, $states: [IssueState!], $after: String) {
  repository(owner: $owner, name: $name) {
    issues(states: $states, first: ${PAGE}, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE} } }
  }
}`

const MILESTONE_ISSUES = `query($owner: String!, $name: String!, $number: Int!, $states: [IssueState!], $after: String) {
  repository(owner: $owner, name: $name) {
    milestone(number: $number) {
      issues(states: $states, first: ${PAGE}, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE} } }
    }
  }
}`

const ISSUE_BRIEF = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { title body } }
}`

const ISSUE_STATE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { id state } }
}`

const CLOSE_ISSUE = `mutation($id: ID!) {
  closeIssue(input: { issueId: $id, stateReason: COMPLETED }) { issue { state } }
}`

export async function connectGithub(settings: GithubSettings, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<TaskSource> {
  const repos = new RepoMap(settings.projects)

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetchImpl(API, {
      method: 'POST',
      headers: { authorization: `bearer ${settings.token}`, 'content-type': 'application/json', 'user-agent': 'even-keel' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json().catch(() => ({}))) as { data?: T | null; errors?: GraphqlError[]; message?: string }
    if (!response.ok) throw new Error(`github: HTTP ${response.status}${body.message ? `: ${body.message}` : ''}`)
    const failed = (body.errors ?? []).filter((error) => error.type !== 'NOT_FOUND')
    if (failed.length > 0 || body.data == null) {
      throw new Error(`github: ${(failed.length > 0 ? failed : (body.errors ?? [])).map((error) => error.message).join('; ') || 'empty answer'}`)
    }
    return body.data
  }

  function repoOf(project: string): Repo {
    const repo = repos.repoOf(project)
    if (repo === undefined) throw new Error(`github: project ${project} has no repository in even-keel.config.json`)
    return repo
  }

  async function collect(
    query: string,
    variables: Record<string, unknown>,
    pick: (data: { repository: Record<string, unknown> | null }) => Connection<GithubIssue> | null | undefined,
    what: string,
  ): Promise<GithubIssue[]> {
    const issues: GithubIssue[] = []
    let after: string | null = null
    do {
      const connection = pick(await graphql(query, { ...variables, after }))
      if (connection == null) throw new Error(`github: ${what} not found or the token cannot see it`)
      issues.push(...connection.nodes)
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    } while (after !== null)
    return issues
  }

  async function issueOf<T>(id: string, query: string): Promise<{ repo: Repo; issue: T }> {
    const parsed = parseTaskId(id)
    if (parsed === null) throw new Error(`github: ${id} is not a task id`)
    const repo = repoOf(parsed.project)
    const data = await graphql<{ repository: { issue: T | null } | null }>(query, { ...repo, number: parsed.number })
    const issue = data.repository?.issue
    if (issue == null) throw new Error(`github: issue ${id} not found in ${repo.owner}/${repo.name}`)
    return { repo, issue }
  }

  await graphql('query { viewer { login } }')

  return {
    async chainTasks(project, open) {
      const repo = repoOf(project)
      const slug = `${repo.owner}/${repo.name}`
      const isOpen = (issue: GithubIssue) => open(githubStatus(issue.state, issue.stateReason))
      const openIssues = (
        await collect(REPOSITORY_ISSUES, { ...repo, states: statesOf(GITHUB_STATUSES.filter(open)) }, (data) => data.repository?.issues as Connection<GithubIssue>, slug)
      ).filter(isOpen)
      const milestones = [...new Set(openIssues.filter((issue) => issue.subIssuesSummary.total === 0).flatMap((issue) => (issue.milestone === null ? [] : [issue.milestone.number])))]
      const closedStates = statesOf(GITHUB_STATUSES.filter((status) => !open(status)))
      const closedIssues = await Promise.all(
        milestones.map((number) =>
          collect(
            MILESTONE_ISSUES,
            { ...repo, number, states: closedStates },
            (data) => (data.repository?.milestone as { issues: Connection<GithubIssue> } | null)?.issues,
            `milestone ${number} of ${slug}`,
          ),
        ),
      )
      const tasks = [...openIssues, ...closedIssues.flat().filter((issue) => !isOpen(issue))].map((issue) => toTrackerTask(issue, repos))
      return { tasks, statuses: GITHUB_STATUSES.map((status) => status.name) }
    },

    async tasks(ids) {
      const wanted = new Map<string, { repo: Repo; numbers: Set<number> }>()
      for (const id of ids) {
        const parsed = parseTaskId(id)
        const repo = parsed === null ? undefined : repos.repoOf(parsed.project)
        if (parsed === null || repo === undefined) continue
        const entry = wanted.get(parsed.project) ?? { repo, numbers: new Set<number>() }
        entry.numbers.add(parsed.number)
        wanted.set(parsed.project, entry)
      }
      if (wanted.size === 0) return []
      const parts = [...wanted.values()].map(({ repo, numbers }, index) => {
        const issues = [...numbers].map((number) => `i${number}: issue(number: ${number}) { ${ISSUE} }`).join('\n')
        return `r${index}: repository(owner: ${JSON.stringify(repo.owner)}, name: ${JSON.stringify(repo.name)}) {\n${issues}\n}`
      })
      const data = await graphql<Record<string, Record<string, GithubIssue | null> | null>>(`query {\n${parts.join('\n')}\n}`)
      return Object.values(data).flatMap((repository): TrackerTask[] =>
        Object.values(repository ?? {}).flatMap((issue) => (issue === null ? [] : [toTrackerTask(issue, repos)])),
      )
    },

    async brief(id) {
      const { issue } = await issueOf<{ title: string; body: string | null }>(id, ISSUE_BRIEF)
      return { title: issue.title, description: issue.body ?? '' }
    },

    async complete(id) {
      const { issue } = await issueOf<{ id: string; state: IssueState }>(id, ISSUE_STATE)
      if (issue.state === 'CLOSED') return false
      await graphql(CLOSE_ISSUE, { id: issue.id })
      return true
    },

    close: async () => {},
  }
}

function statesOf(statuses: readonly TaskStatus[]): IssueState[] {
  const states = new Set(statuses.map((status): IssueState => (status.category === 'ToDo' ? 'OPEN' : 'CLOSED')))
  return (['OPEN', 'CLOSED'] as const).filter((state) => states.has(state))
}
