import { linkedFiles } from '../tracker/comments.js'
import type { ImportAuthor, ImportChange, ImportComment, ImportFile, ImportImage, ImportLink, ImportMilestone, ImportSource, ImportTask } from '../tracker/import.js'
import type { TaskPriority } from '../tracker/model.js'
import { githubPriority, githubStatus, PRIORITY_LABEL, type IssueState, type IssueStateReason, type Repo, type RepoMap } from './model.js'
import { uploadId, UPLOADS } from './uploads.js'

export interface GithubImportDeps {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>
  repo: Repo
  repos: RepoMap
  /** The login of the token's account: what it wrote is the agent's. */
  viewer: string
  /** An upload of the task `id`, its bytes and type; `null` — GitHub gives it no more. */
  download(id: string, link: string): Promise<{ type: string; bytes: Uint8Array } | null>
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: T[]
}

interface LinkNode {
  id: string
  number: number
  repository: { nameWithOwner: string }
}

interface IssueNode extends LinkNode {
  title: string
  body: string | null
  state: IssueState
  stateReason: IssueStateReason | null
  createdAt: string
  updatedAt?: string
  closedAt: string | null
  author: { login: string } | null
  parent: LinkNode | null
  blockedBy: { nodes: LinkNode[] }
  blocking: { nodes: LinkNode[] }
  labels: { nodes: { name: string }[] }
  milestone: { title: string } | null
}

interface CommentNode {
  id: string
  body: string
  createdAt: string
  author: { login: string } | null
}

type EventNode = { __typename: string; createdAt: string; actor: { login: string } | null } & Partial<{
  stateReason: IssueStateReason | null
  previousTitle: string
  currentTitle: string
  milestoneTitle: string
  label: { name: string }
  parent: LinkNode | null
}>

const PAGE = 100
const LINK = 'id number repository { nameWithOwner }'

// `issues` gives issues alone: pull requests are no tasks and are not read.
const ISSUES = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    owner { __typename login }
    issues(first: ${PAGE}, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ${LINK} title body state stateReason createdAt updatedAt closedAt author { login }
        parent { ${LINK} }
        blockedBy(first: 50) { nodes { ${LINK} } }
        blocking(first: 50) { nodes { ${LINK} } }
        labels(first: 100) { nodes { name } }
        milestone { title }
      }
    }
  }
}`

const MILESTONES = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    milestones(first: ${PAGE}, after: $after, states: [OPEN, CLOSED]) {
      pageInfo { hasNextPage endCursor }
      nodes { title description dueOn state closedAt }
    }
  }
}`

interface MilestoneNode {
  title: string
  description: string | null
  dueOn: string | null
  state: 'OPEN' | 'CLOSED'
  closedAt: string | null
}

const COMMENTS = `query($id: ID!, $after: String) {
  node(id: $id) { ... on Issue { comments(first: ${PAGE}, after: $after) { pageInfo { hasNextPage endCursor } nodes { id body createdAt author { login } } } } }
}`

const EVENTS = `query($id: ID!, $after: String) {
  node(id: $id) {
    ... on Issue {
      timelineItems(first: ${PAGE}, after: $after, itemTypes: [CLOSED_EVENT, REOPENED_EVENT, RENAMED_TITLE_EVENT, MILESTONED_EVENT, DEMILESTONED_EVENT, LABELED_EVENT, UNLABELED_EVENT, PARENT_ISSUE_ADDED_EVENT, PARENT_ISSUE_REMOVED_EVENT]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on ClosedEvent { createdAt actor { login } stateReason }
          ... on ReopenedEvent { createdAt actor { login } }
          ... on RenamedTitleEvent { createdAt actor { login } previousTitle currentTitle }
          ... on MilestonedEvent { createdAt actor { login } milestoneTitle }
          ... on DemilestonedEvent { createdAt actor { login } milestoneTitle }
          ... on LabeledEvent { createdAt actor { login } label { name } }
          ... on UnlabeledEvent { createdAt actor { login } label { name } }
          ... on ParentIssueAddedEvent { createdAt actor { login } parent { ${LINK} } }
          ... on ParentIssueRemovedEvent { createdAt actor { login } parent { ${LINK} } }
        }
      }
    }
  }
}`

/** A label that only carries the priority: the priority takes it, the labels do not. */
const isPriority = (label: string) => PRIORITY_LABEL.test(label.trim())

/**
 * The import's read of a GitHub repository (BTN-1403): every issue, closed ones too, its comments, the files uploaded
 * into its texts and the change log of its timeline. GitHub keeps no estimate, component, related tasks or threads.
 * The issues are read once, on the first call; comments a task at a time, the last task's kept for its files.
 */
export function githubImport(deps: GithubImportDeps): ImportSource {
  const { graphql, repo, repos } = deps
  const slug = `${repo.owner}/${repo.name}`.toLowerCase()

  let loading: Promise<{ tasks: ImportTask[]; author: (login: string | undefined) => ImportAuthor | null }> | null = null
  const project = () =>
    (loading ??= load().catch((error: unknown) => {
      loading = null
      throw error
    }))

  async function pages<T, D>(query: string, variables: Record<string, unknown>, pick: (data: D) => Page<T> | null | undefined, what: string): Promise<T[]> {
    const out: T[] = []
    let after: string | null = null
    do {
      const connection = pick(await graphql<D>(query, { ...variables, after }))
      if (connection == null) throw new Error(`github: ${what} not found or the token cannot see it`)
      out.push(...connection.nodes)
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    } while (after !== null)
    return out
  }

  async function load() {
    type Owner = { __typename: string; login: string }
    const seen: { owner?: Owner } = {}
    const issues = await pages(ISSUES, { ...repo }, (data: { repository: { owner: Owner; issues: Page<IssueNode> } | null }) => {
      if (data.repository !== null) seen.owner = data.repository.owner
      return data.repository?.issues
    }, slug)
    // The repository's owner is the user when it is a person; an organisation's members are people of the tracker.
    const user = seen.owner?.__typename === 'User' ? seen.owner.login : null
    const author = (login: string | undefined): ImportAuthor | null =>
      login === undefined ? null : { kind: login === deps.viewer ? 'agent' : login === user ? 'user' : 'person', name: login }
    const link = (node: LinkNode): ImportLink => ({ ref: node.id, id: repos.idOf(node), foreign: node.repository.nameWithOwner.toLowerCase() !== slug })
    const tasks = issues.map((issue): ImportTask => {
      const labels = issue.labels.nodes.map((label) => label.name)
      const body = issue.body ?? ''
      return {
        ref: issue.id,
        number: issue.number,
        id: repos.idOf(issue),
        title: issue.title,
        description: body,
        images: uploadsOf(body).map(imageOf),
        status: githubStatus(issue.state, issue.stateReason),
        priority: githubPriority(labels),
        milestone: issue.milestone?.title ?? null,
        component: null,
        labels: labels.filter((label) => !isPriority(label)),
        estimate: null,
        parent: issue.parent === null ? null : link(issue.parent),
        blocks: issue.blocking.nodes.map(link),
        blockedBy: issue.blockedBy.nodes.map(link),
        related: [],
        createdAt: Date.parse(issue.createdAt),
        createdBy: author(issue.author?.login),
        closedAt: issue.state === 'CLOSED' && issue.closedAt !== null ? Date.parse(issue.closedAt) : null,
        // A comment, a label or a closing moves it.
        modifiedAt: issue.updatedAt === undefined ? null : Date.parse(issue.updatedAt),
      }
    })
    return { tasks: tasks.sort((a, b) => a.number - b.number), author }
  }

  let thread: { ref: string; comments: Promise<CommentNode[]> } | null = null
  function commentsOf(ref: string): Promise<CommentNode[]> {
    if (thread?.ref === ref) return thread.comments
    const comments = pages(COMMENTS, { id: ref }, (data: { node: { comments?: Page<CommentNode> } | null }) => data.node?.comments, `issue ${ref}`)
    thread = { ref, comments }
    comments.catch(() => {
      if (thread?.comments === comments) thread = null
    })
    return comments
  }

  async function taskOf(ref: string): Promise<ImportTask> {
    const task = (await project()).tasks.find((each) => each.ref === ref)
    if (task === undefined) throw new Error(`github: issue ${ref} is not one of ${slug}`)
    return task
  }

  return {
    tasks: async () => (await project()).tasks,

    // GitHub keeps a milestone open or closed: a closed one is completed.
    async milestones() {
      const nodes = await pages(MILESTONES, { ...repo }, (data: { repository: { milestones: Page<MilestoneNode> } | null }) => data.repository?.milestones, slug)
      return nodes.map((node): ImportMilestone => ({
        name: node.title,
        date: node.dueOn === null ? null : Date.parse(node.dueOn),
        status: node.state === 'CLOSED' ? 'completed' : 'planned',
        description: node.description ?? '',
        closedAt: node.state === 'CLOSED' && node.closedAt !== null ? Date.parse(node.closedAt) : null,
      }))
    },

    async comments(ref) {
      const [{ author }, nodes] = await Promise.all([project(), commentsOf(ref)])
      return [...nodes]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map((node): ImportComment => {
          const uploads = uploadsOf(node.body)
          return {
            ref: node.id,
            author: author(node.author?.login),
            at: Date.parse(node.createdAt),
            body: node.body,
            images: uploads.map(imageOf),
            files: uploads.map((upload) => upload.key),
            replyTo: null,
          }
        })
    },

    async files(ref) {
      const [task, nodes] = await Promise.all([taskOf(ref), commentsOf(ref)])
      const files = new Map<string, ImportFile>()
      for (const upload of [...uploadsOf(task.description), ...nodes.flatMap((node) => uploadsOf(node.body))]) {
        if (files.has(upload.key)) continue
        // GitHub names no type before the download: the file takes the one it is served with.
        const file: ImportFile = {
          key: upload.key,
          name: upload.name,
          type: '',
          size: null,
          async read() {
            const got = await deps.download(task.id, upload.link)
            if (got === null) return null
            file.type = got.type
            file.size = got.bytes.byteLength
            return got.bytes
          },
        }
        files.set(upload.key, file)
      }
      return [...files.values()]
    },

    async changes(ref) {
      const { author } = await project()
      const events = await pages(EVENTS, { id: ref }, (data: { node: { timelineItems?: Page<EventNode> } | null }) => data.node?.timelineItems, `issue ${ref}`)
      return changesOf(events, repos).map((change) => ({ ...change, author: author(change.author) }))
    },
  }
}

interface Upload {
  key: string
  link: string
  name: string
}

/** The files uploaded into a text, each once: its key is the upload's id, or the link where it has none. */
function uploadsOf(text: string): Upload[] {
  return linkedFiles(text, UPLOADS).map(({ name, file }) => ({ key: uploadId(file) ?? file, link: file, name }))
}

// Every upload link, a file's as a picture's, stands at its own address: the import points it at the attachment.
const imageOf = (upload: Upload): ImportImage => ({ ref: upload.link, file: upload.key })

type Change = Omit<ImportChange, 'author'> & { author: string | undefined }

/**
 * The timeline's events as the change log, oldest first. The status, milestone and labels are replayed from an open
 * issue with none: GitHub records the labels and the milestone set at creation as events too. A priority label is a
 * change of the priority, not of the labels.
 */
function changesOf(events: readonly EventNode[], repos: RepoMap): Change[] {
  let status = githubStatus('OPEN', null).name
  let milestone: string | null = null
  const labels = new Set<string>()
  const priority = (): string | null => {
    const level: TaskPriority = githubPriority([...labels])
    return level === 'none' ? null : level
  }
  const out: Change[] = []
  for (const event of [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    const at = Date.parse(event.createdAt)
    const author = event.actor?.login
    const push = (field: Change['field'], from: string | null, to: string | null) => {
      if (from !== to) out.push({ at, author, field, from, to })
    }
    switch (event.__typename) {
      case 'ClosedEvent': {
        const to = githubStatus('CLOSED', event.stateReason ?? null).name
        push('status', status, to)
        status = to
        break
      }
      case 'ReopenedEvent': {
        const to = githubStatus('OPEN', null).name
        push('status', status, to)
        status = to
        break
      }
      case 'RenamedTitleEvent':
        push('title', event.previousTitle ?? null, event.currentTitle ?? null)
        break
      case 'MilestonedEvent':
        push('milestone', milestone, event.milestoneTitle ?? null)
        milestone = event.milestoneTitle ?? null
        break
      case 'DemilestonedEvent':
        push('milestone', event.milestoneTitle ?? milestone, null)
        milestone = null
        break
      case 'LabeledEvent':
      case 'UnlabeledEvent': {
        const name = event.label?.name
        if (name === undefined) break
        const added = event.__typename === 'LabeledEvent'
        if (added === labels.has(name)) break
        const before = priority()
        if (added) labels.add(name)
        else labels.delete(name)
        if (isPriority(name)) push('priority', before, priority())
        else push('label', added ? null : name, added ? name : null)
        break
      }
      case 'ParentIssueAddedEvent':
        if (event.parent != null) push('parent', null, repos.idOf(event.parent))
        break
      case 'ParentIssueRemovedEvent':
        if (event.parent != null) push('parent', repos.idOf(event.parent), null)
        break
    }
  }
  return out
}
