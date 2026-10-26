import { commentsAfterId, linkedFiles } from '../tracker/comments.js'
import { trackedFetch } from '../tracker/diagnostics.js'
import { parseTaskId, type TaskStatus, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound, type TaskSource, type TrackerPlace } from '../tracker/source.js'
import { GITHUB_STATUSES, githubStatus, RepoMap, toCard, toTrackerTask, type GithubCardIssue, type GithubIssue, type IssueState, type Repo } from './model.js'
import { Skipped, trustedAuthor } from './trust.js'

export interface GithubSettings {
  token: string
  /** The place of each project by its id: its key and its repository, `owner/name`. */
  projects: Readonly<Record<string, TrackerPlace>>
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

const AUTHOR = 'author { login } authorAssociation'

interface Authored {
  author: { login: string } | null
  authorAssociation: string
}

const REPOSITORY_ISSUES =`query($owner: String!, $name: String!, $states: [IssueState!], $after: String) {
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

// `query` matches titles loosely: the exact one is picked from the answer.
const MILESTONE_NUMBERS = `query($owner: String!, $name: String!, $title: String!) {
  repository(owner: $owner, name: $name) { milestones(first: 100, query: $title, states: [OPEN, CLOSED]) { nodes { number title } } }
}`

const MILESTONE_TASKS = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    milestone(number: $number) {
      issues(first: ${PAGE}, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE} comments(last: 10) { nodes { body ${AUTHOR} } } } }
    }
  }
}`

const ISSUE_BRIEF = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { title body } }
}`

const CARD_REF = 'number title state stateReason repository { nameWithOwner }'

const ISSUE_CARD = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      id number title state stateReason body
      repository { nameWithOwner }
      subIssuesSummary { total }
      parent { ${CARD_REF} }
      blockedBy(first: 50) { nodes { ${CARD_REF} } }
      blocking(first: 50) { nodes { ${CARD_REF} } }
      labels(first: 50) { nodes { name } }
      milestone { number title dueOn }
      comments(first: 100) { nodes { author { login } createdAt body } }
    }
  }
}`

const ISSUE_STATE =`query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { id state } }
}`

const CLOSE_ISSUE = `mutation($id: ID!) {
  closeIssue(input: { issueId: $id, stateReason: COMPLETED }) { issue { state } }
}`

const ISSUE_COMMENTS = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { comments(last: 100) { nodes { id body ${AUTHOR} } } } }
}`

const VISIBILITY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { isPrivate }
}`

const ADD_COMMENT = `mutation($id: ID!, $body: String!) {
  addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { id } } }
}`

const CREATE_CONTEXT = `query($owner: String!, $name: String!, $label: String!, $number: Int!, $withIssue: Boolean!) {
  repository(owner: $owner, name: $name) {
    id
    label(name: $label) { id }
    issue(number: $number) @include(if: $withIssue) { milestone { id } }
  }
}`

const CREATE_ISSUE = `mutation($input: CreateIssueInput!) {
  createIssue(input: $input) { issue { number } }
}`

const ISSUE_MILESTONES = `query($owner: String!, $name: String!, $number: Int!, $like: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { id milestone { id } }
    like: issue(number: $like) { milestone { id } }
  }
}`

const SET_MILESTONE = `mutation($id: ID!, $milestone: ID!) {
  updateIssue(input: { id: $id, milestoneId: $milestone }) { issue { number } }
}`

const MILESTONE_CHOICES = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { milestone { id title dueOn closed } }
    milestones(states: OPEN, first: 100) { nodes { id title dueOn } }
  }
}`

const MOVE_MILESTONE = `mutation($id: ID!, $milestone: ID) {
  updateIssue(input: { id: $id, milestoneId: $milestone }) { issue { number } }
}`

const REPOSITORY_LABELS = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) { labels(first: ${PAGE}, after: $after) { pageInfo { hasNextPage endCursor } nodes { name } } }
}`

/** Where GitHub keeps the files dropped into a comment. */
const UPLOADS = /^https:\/\/(github\.com\/user-attachments\/|private-user-images\.githubusercontent\.com\/)/

export async function connectGithub(
  settings: GithubSettings,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = console.log,
): Promise<TaskSource> {
  const repos = new RepoMap(settings.projects)
  const skipped = new Skipped(log)

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await trackedFetch(fetchImpl, API, {
      method: 'POST',
      headers: { authorization: `bearer ${settings.token}`, 'content-type': 'application/json', 'user-agent': 'even-keel' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    }, '/graphql')
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

  /** The repository of the tasks whose ids start with `key`. */
  function repoOfTasks(key: string): Repo {
    const repo = repos.repoOfKey(key)
    if (repo === undefined) throw new Error(`github: no project with the key ${key} has a repository in even-keel.config.json`)
    return repo
  }

  async function collect<T = GithubIssue>(
    query: string,
    variables: Record<string, unknown>,
    pick: (data: { repository: Record<string, unknown> | null }) => Connection<T> | null | undefined,
    what: string,
  ): Promise<T[]> {
    const issues: T[] = []
    let after: string | null = null
    do {
      const connection = pick(await graphql(query, { ...variables, after }))
      if (connection == null) throw new TrackerNotFound(`github: ${what} not found or the token cannot see it`)
      issues.push(...connection.nodes)
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    } while (after !== null)
    return issues
  }

  async function issueOf<T>(id: string, query: string): Promise<{ repo: Repo; issue: T }> {
    const parsed = parseTaskId(id)
    if (parsed === null) throw new Error(`github: ${id} is not a task id`)
    const repo = repoOfTasks(parsed.project)
    const data = await graphql<{ repository: { issue: T | null } | null }>(query, { ...repo, number: parsed.number })
    const issue = data.repository?.issue
    if (issue == null) throw new TrackerNotFound(`github: issue ${id} not found in ${repo.owner}/${repo.name}`)
    return { repo, issue }
  }

  const { viewer } = await graphql<{ viewer: { login: string } }>('query { viewer { login } }')
  const trusted = (comment: Authored) => trustedAuthor(comment.authorAssociation, comment.author?.login, viewer.login)

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
        const repo = parsed === null ? undefined : repos.repoOfKey(parsed.project)
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

    async card(id) {
      const { issue } = await issueOf<GithubCardIssue>(id, ISSUE_CARD)
      return toCard(issue, repos)
    },

    async complete(id) {
      const { issue } = await issueOf<{ id: string; state: IssueState }>(id, ISSUE_STATE)
      if (issue.state === 'CLOSED') return false
      await graphql(CLOSE_ISSUE, { id: issue.id })
      return true
    },

    closingRef(id) {
      const parsed = parseTaskId(id)
      const repo = parsed === null ? undefined : repos.repoOfKey(parsed.project)
      return repo === undefined ? null : `${repo.owner}/${repo.name}#${parsed!.number}`
    },

    async comment(id, body) {
      const { issue } = await issueOf<{ id: string }>(id, ISSUE_STATE)
      const data = await graphql<{ addComment: { commentEdge: { node: { id: string } } } }>(ADD_COMMENT, { id: issue.id, body })
      return data.addComment.commentEdge.node.id
    },

    async commentsAfter(id, after) {
      const { repo, issue } = await issueOf<{ comments: { nodes: ({ id: string; body: string } & Authored)[] } }>(id, ISSUE_COMMENTS)
      const passed = commentsAfterId(issue.comments.nodes, after).filter((node) => {
        if (trusted(node)) return true
        const author = node.author === null ? 'a deleted account' : node.author.login
        skipped.note(node.id, `github: ${id}: the comment ${node.id} of ${author} is skipped: its author is not a collaborator of ${repo.owner}/${repo.name}`)
        return false
      })
      return passed.map((node) => ({ id: node.id, body: node.body, files: linkedFiles(node.body, UPLOADS) }))
    },

    async isPublic(project) {
      const repo = repoOf(project)
      const { repository } = await graphql<{ repository: { isPrivate: boolean } | null }>(VISIBILITY, { ...repo })
      if (repository === null) throw new TrackerNotFound(`github: ${repo.owner}/${repo.name} not found or the token cannot see it`)
      return !repository.isPrivate
    },

    // An open issue is the ready status; the priority goes on as the label `priority: <level>` when the repository has it.
    async create(task) {
      const repo = repoOf(task.project)
      const key = repos.projectKey(task.project)!
      const source = task.milestoneOf === null ? null : parseTaskId(task.milestoneOf)
      const number = source !== null && source.project === key ? source.number : null
      const context = await graphql<{
        repository: { id: string; label: { id: string } | null; issue?: { milestone: { id: string } | null } | null } | null
      }>(CREATE_CONTEXT, { ...repo, label: `priority: ${task.priority}`, number: number ?? 0, withIssue: number !== null })
      const repository = context.repository
      if (repository === null) throw new TrackerNotFound(`github: ${repo.owner}/${repo.name} not found or the token cannot see it`)
      const milestoneId = repository.issue?.milestone?.id
      const input = {
        repositoryId: repository.id,
        title: task.title,
        body: task.description,
        ...(repository.label === null ? {} : { labelIds: [repository.label.id] }),
        ...(milestoneId === undefined ? {} : { milestoneId }),
      }
      const data = await graphql<{ createIssue: { issue: { number: number } } }>(CREATE_ISSUE, { input })
      return `${key}-${data.createIssue.issue.number}`
    },

    // A milestone belongs to a repository: a task of another project gives none.
    async setMilestone(id, milestoneOf) {
      const like = parseTaskId(milestoneOf)
      if (like === null || like.project !== parseTaskId(id)?.project) return false
      const { repository } = await graphql<{
        repository: { issue: { id: string; milestone: { id: string } | null } | null; like: { milestone: { id: string } | null } | null } | null
      }>(ISSUE_MILESTONES, { ...repoOfTasks(like.project), number: parseTaskId(id)!.number, like: like.number })
      const issue = repository?.issue
      if (issue == null) throw new TrackerNotFound(`github: issue ${id} not found`)
      const milestone = repository?.like?.milestone
      if (issue.milestone !== null || milestone == null) return false
      await graphql(SET_MILESTONE, { id: issue.id, milestone: milestone.id })
      return true
    },

    async milestones(id) {
      type Choice = { id: string; title: string; dueOn: string | null }
      const parsed = parseTaskId(id)
      if (parsed === null) throw new Error(`github: ${id} is not a task id`)
      const repo = repoOfTasks(parsed.project)
      const { repository } = await graphql<{
        repository: { issue: { milestone: (Choice & { closed: boolean }) | null } | null; milestones: { nodes: Choice[] } } | null
      }>(MILESTONE_CHOICES, { ...repo, number: parsed.number })
      const issue = repository?.issue
      if (repository == null || issue == null) throw new TrackerNotFound(`github: issue ${id} not found in ${repo.owner}/${repo.name}`)
      const own = issue.milestone
      const choices = [...repository.milestones.nodes, ...(own?.closed ? [own] : [])]
      return {
        current: own?.id ?? null,
        choices: choices.map((each) => ({ id: each.id, label: each.title, targetDate: each.dueOn === null ? null : Date.parse(each.dueOn) })),
      }
    },

    async moveMilestone(id, milestone) {
      const { issue } = await issueOf<{ id: string }>(id, ISSUE_STATE)
      await graphql(MOVE_MILESTONE, { id: issue.id, milestone })
    },

    async milestoneTasks(project, milestone) {
      const repo = repoOf(project)
      const { repository } = await graphql<{ repository: { milestones: { nodes: { number: number; title: string }[] } } | null }>(MILESTONE_NUMBERS, {
        ...repo,
        title: milestone,
      })
      const found = repository?.milestones.nodes.find((each) => each.title === milestone)
      if (found === undefined) return []
      const issues = (await collect(
        MILESTONE_TASKS,
        { ...repo, number: found.number },
        (data) => (data.repository?.milestone as { issues: Connection<GithubIssue> } | null)?.issues,
        `milestone ${found.number} of ${repo.owner}/${repo.name}`,
      )) as (GithubIssue & { comments: { nodes: ({ body: string } & Authored)[] } })[]
      return issues.map((issue) => ({ ...toTrackerTask(issue, repos), lastComment: issue.comments.nodes.findLast(trusted)?.body ?? null }))
    },

    async vocabulary(project) {
      const repo = repoOf(project)
      const labels = await collect<{ name: string }>(REPOSITORY_LABELS, { ...repo }, (data) => data.repository?.labels as Connection<{ name: string }>, `${repo.owner}/${repo.name}`)
      return { statuses: [...GITHUB_STATUSES], labels: labels.map((label) => label.name) }
    },

    // A file of a comment is its upload link; the token goes only to GitHub's own upload hosts.
    async file(_id, file) {
      if (!UPLOADS.test(file)) return null
      const response = await trackedFetch(fetchImpl, file, { headers: { authorization: `bearer ${settings.token}`, 'user-agent': 'even-keel' }, signal: AbortSignal.timeout(timeoutMs) }, '/uploads/[redacted]')
      if (!response.ok || response.body === null) return null
      const size = Number.parseInt(response.headers.get('content-length') ?? '', 10)
      return { type: response.headers.get('content-type') ?? '', size: Number.isNaN(size) ? null : size, body: response.body }
    },

    close: async () => {},
  }
}

function statesOf(statuses: readonly TaskStatus[]): IssueState[] {
  const states = new Set(statuses.map((status): IssueState => (status.category === 'ToDo' ? 'OPEN' : 'CLOSED')))
  return (['OPEN', 'CLOSED'] as const).filter((state) => states.has(state))
}
