import { descriptionEdits, EditRefused, type TaskEditor } from '../tracker/editor.js'
import type { LabelChange } from '../tracker/labels.js'
import { parseTaskId, type TaskPriority, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound } from '../tracker/source.js'
import { GITHUB_STATUSES, githubPriority, githubStatus, PRIORITY_LABEL, type IssueRef, type IssueState, type IssueStateReason, type Repo, type RepoMap } from './model.js'

export interface GithubEditorDeps {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>
  repos: RepoMap
  /** Every issue of the project's repository, open and closed. */
  list(project: string): Promise<TrackerTask[]>
  relabel(id: string, change: LabelChange): Promise<string[]>
  comment(id: string, body: string): Promise<string>
}

interface NodeRef extends IssueRef {
  id: string
}

interface EditIssue extends NodeRef {
  title: string
  body: string | null
  state: IssueState
  stateReason: IssueStateReason | null
  milestone: { id: string; title: string } | null
  parent: NodeRef | null
  labels: { nodes: { name: string }[] }
  blockedBy: { nodes: NodeRef[] }
}

const REF = 'id number repository { nameWithOwner }'

const EDIT_ISSUE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${REF} title body state stateReason
      milestone { id title }
      parent { ${REF} }
      labels(first: 100) { nodes { name } }
      blockedBy(first: 100) { nodes { ${REF} } }
    }
  }
}`

const CONTEXT = `query($owner: String!, $name: String!, $title: String!, $withMilestone: Boolean!) {
  repository(owner: $owner, name: $name) {
    id
    milestones(first: 100, query: $title, states: [OPEN, CLOSED]) @include(if: $withMilestone) { nodes { id title } }
    labels(first: 100, query: "priority") { nodes { name } }
  }
}`

const CREATE_ISSUE = `mutation($input: CreateIssueInput!) {
  createIssue(input: $input) { issue { number } }
}`

const UPDATE_ISSUE = `mutation($input: UpdateIssueInput!) {
  updateIssue(input: $input) { issue { number } }
}`

const CLOSE_ISSUE = `mutation($id: ID!, $reason: IssueClosedStateReason!) {
  closeIssue(input: { issueId: $id, stateReason: $reason }) { issue { state } }
}`

const REOPEN_ISSUE = `mutation($id: ID!) {
  reopenIssue(input: { issueId: $id }) { issue { state } }
}`

const ADD_SUB_ISSUE = `mutation($parent: ID!, $child: ID!) {
  addSubIssue(input: { issueId: $parent, subIssueId: $child, replaceParent: true }) { issue { number } }
}`

const REMOVE_SUB_ISSUE = `mutation($parent: ID!, $child: ID!) {
  removeSubIssue(input: { issueId: $parent, subIssueId: $child }) { issue { number } }
}`

const ADD_BLOCKED_BY = `mutation($issue: ID!, $blocker: ID!) {
  addBlockedBy(input: { issueId: $issue, blockingIssueId: $blocker }) { issue { number } }
}`

const REMOVE_BLOCKED_BY = `mutation($issue: ID!, $blocker: ID!) {
  removeBlockedBy(input: { issueId: $issue, blockingIssueId: $blocker }) { issue { number } }
}`

/** The state a status name stands for; closed ones by their reason. */
const CLOSED_REASONS: Record<string, 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE'> = { completed: 'COMPLETED', 'not planned': 'NOT_PLANNED', duplicate: 'DUPLICATE' }

/**
 * GitHub's writes for the tasks MCP server (BTN-875). A status is the issue's state and its close reason, a priority
 * the repository's label `priority: <level>`, the parent a sub-issue, `blocks` the native "blocked by". GitHub has no
 * "relates" link and no revision of an issue's body (`updatedAt` grows with any field), so the revision is a hash.
 */
export function githubEditor(deps: GithubEditorDeps): TaskEditor {
  const { graphql, repos } = deps

  const placeOf = (id: string): { repo: Repo; number: number } => {
    const parsed = parseTaskId(id)
    const repo = parsed === null ? undefined : repos.repoOfKey(parsed.project)
    if (parsed === null || repo === undefined) throw new EditRefused(`${id} is not a task of a GitHub project these tools serve`)
    return { repo, number: parsed.number }
  }
  const issueOf = async (id: string): Promise<EditIssue> => {
    const { repo, number } = placeOf(id)
    const data = await graphql<{ repository: { issue: EditIssue | null } | null }>(EDIT_ISSUE, { ...repo, number })
    const issue = data.repository?.issue
    if (issue == null) throw new TrackerNotFound(`github: issue ${id} not found in ${repo.owner}/${repo.name}`)
    return issue
  }
  const contextOf = async (repo: Repo, milestone: string | null) => {
    const data = await graphql<{
      repository: { id: string; milestones?: { nodes: { id: string; title: string }[] }; labels: { nodes: { name: string }[] } } | null
    }>(CONTEXT, { ...repo, title: milestone ?? '', withMilestone: milestone !== null })
    const repository = data.repository
    if (repository === null) throw new TrackerNotFound(`github: ${repo.owner}/${repo.name} not found or the token cannot see it`)
    const milestoneId = (): string => {
      const found = repository.milestones?.nodes.find((each) => each.title.toLocaleLowerCase() === milestone!.toLocaleLowerCase())
      if (found === undefined) throw new EditRefused(`there is no milestone "${milestone}" in ${repo.owner}/${repo.name}`)
      return found.id
    }
    const priorityLabel = (level: TaskPriority): string => {
      const found = repository.labels.nodes.find((each) => PRIORITY_LABEL.exec(each.name.trim())?.[1]?.toLowerCase() === level)
      if (found === undefined) {
        throw new EditRefused(`GitHub keeps a priority as the label "priority: ${level}", and ${repo.owner}/${repo.name} has none; only the user makes a new label`)
      }
      return found.name
    }
    return { id: repository.id, milestoneId, priorityLabel }
  }
  const setStatus = async (issue: EditIssue, name: string): Promise<boolean> => {
    const target = GITHUB_STATUSES.find((each) => each.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (target === undefined) throw new EditRefused(`there is no status "${name}"; the statuses are ${GITHUB_STATUSES.map((each) => each.name).join(', ')}`)
    if (githubStatus(issue.state, issue.stateReason).name === target.name) return false
    // A closed issue takes another close reason only by being reopened first.
    if (issue.state === 'CLOSED') await graphql(REOPEN_ISSUE, { id: issue.id })
    const reason = CLOSED_REASONS[target.name.toLocaleLowerCase()]
    if (reason !== undefined) await graphql(CLOSE_ISSUE, { id: issue.id, reason })
    return true
  }
  const setParent = async (issue: EditIssue, parent: string | null): Promise<boolean> => {
    const current = issue.parent === null ? null : repos.idOf(issue.parent)
    if (current?.toUpperCase() === parent?.toUpperCase()) return false
    if (parent === null) {
      await graphql(REMOVE_SUB_ISSUE, { parent: issue.parent!.id, child: issue.id })
      return true
    }
    const target = await issueOf(parent)
    if (target.id === issue.id) throw new EditRefused(`${parent} cannot be its own parent`)
    await graphql(ADD_SUB_ISSUE, { parent: target.id, child: issue.id })
    return true
  }
  const update = async (issue: EditIssue, input: Record<string, unknown>): Promise<true> => {
    await graphql(UPDATE_ISSUE, { input: { id: issue.id, ...input } })
    return true
  }

  return {
    list: (project) => deps.list(project),
    priorities: (labels) => labels.some((each) => PRIORITY_LABEL.test(each.trim())),
    async create(project, draft) {
      const repo = repos.repoOf(project)
      const key = repos.projectKey(project)
      if (repo === undefined || key === undefined) throw new EditRefused(`project ${project} has no GitHub repository`)
      const context = await contextOf(repo, draft.milestone)
      const priority = draft.priority === null || draft.priority === 'none' ? null : context.priorityLabel(draft.priority)
      const parent = draft.parent === null ? null : await issueOf(draft.parent)
      const input = {
        repositoryId: context.id,
        title: draft.title,
        body: draft.description,
        ...(draft.milestone === null ? {} : { milestoneId: context.milestoneId() }),
        ...(parent === null ? {} : { parentIssueId: parent.id }),
      }
      const data = await graphql<{ createIssue: { issue: { number: number } } }>(CREATE_ISSUE, { input })
      const id = `${key}-${data.createIssue.issue.number}`
      const labels = [...draft.labels, ...(priority === null ? [] : [priority])]
      if (labels.length > 0) await deps.relabel(id, { add: labels, remove: [] })
      if (draft.status !== null && CLOSED_REASONS[draft.status.toLocaleLowerCase()] !== undefined) await setStatus(await issueOf(id), draft.status)
      return id
    },
    async set(id, field) {
      const issue = await issueOf(id)
      switch (field.field) {
        case 'title':
          return issue.title === field.to ? false : update(issue, { title: field.to })
        case 'status':
          return setStatus(issue, field.to)
        case 'priority': {
          const labels = issue.labels.nodes.map((each) => each.name)
          if (githubPriority(labels) === field.to) return false
          const add = field.to === 'none' ? [] : [(await contextOf(placeOf(id).repo, null)).priorityLabel(field.to)]
          await deps.relabel(id, { add, remove: labels.filter((each) => PRIORITY_LABEL.test(each.trim())) })
          return true
        }
        case 'milestone': {
          if (field.to === null) return issue.milestone === null ? false : update(issue, { milestoneId: null })
          if (issue.milestone?.title.toLocaleLowerCase() === field.to.toLocaleLowerCase()) return false
          return update(issue, { milestoneId: (await contextOf(placeOf(id).repo, field.to)).milestoneId() })
        }
        case 'parent':
          return setParent(issue, field.to)
        case 'component':
          throw new EditRefused('GitHub has no components')
      }
    },
    ...descriptionEdits({
      read: async (id) => (await issueOf(id)).body ?? '',
      write: async (id, text) => void (await update(await issueOf(id), { body: text })),
    }),
    async link(id, other, link, on) {
      if (link === 'relates') throw new EditRefused('GitHub has no "relates" link; name the other task in the description or a comment')
      const [issue, target] = await Promise.all([issueOf(id), issueOf(other)])
      if (issue.id === target.id) throw new EditRefused(`${id} cannot be linked to itself`)
      const [blocker, blocked] = link === 'blocks' ? [issue, target] : [target, issue]
      if (blocked.blockedBy.nodes.some((each) => each.id === blocker.id) === on) return
      await graphql(on ? ADD_BLOCKED_BY : REMOVE_BLOCKED_BY, { issue: blocked.id, blocker: blocker.id })
    },
    relabel: (id, change) => deps.relabel(id, change),
    // A GitHub comment has no field for the session's model: its author is the token's account.
    comment: (id, body) => deps.comment(id, body),
  }
}
