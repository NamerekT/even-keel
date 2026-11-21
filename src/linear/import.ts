import { linkedFiles } from '../tracker/comments.js'
import type { ImportAuthor, ImportChange, ImportComment, ImportFile, ImportImage, ImportLink, ImportMilestone, ImportSource, ImportTask } from '../tracker/import.js'
import { linearMinutes } from './estimate.js'
import { LINEAR_UPLOADS, linearPriority, linearStatus, type LinearAttachment, type LinearState } from './model.js'

export interface LinearImportDeps {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>
  /** The issues of the project: its team, narrowed to its Linear project where it names one. */
  filter: Record<string, unknown>
  /** What the project reads, for errors: `ENG` or `ENG/Web app`. */
  place: string
  /** The team's points, smallest first; `null` — the team estimates nothing. */
  scale: readonly number[] | null
  /** The id of the key's account: what it wrote is the agent's. */
  viewer: string
  /** The team's id, and the Linear project's the place names; a whole team has none. */
  team: string
  project?: string
  /** The id of the user: the creator of the Linear project the place names; `null` — a whole team has none. */
  user: string | null
  /** An upload of the task `id`, its bytes and type; `null` — Linear gives it no more. */
  download(id: string, link: string): Promise<{ type: string; bytes: Uint8Array } | null>
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: T[]
}

interface UserNode {
  id: string
  name: string
}

interface LinkNode {
  id: string
  identifier: string
}

interface IssueNode extends LinkNode {
  number: number
  title: string
  description: string | null
  priority: number
  estimate: number | null
  trashed: boolean | null
  state: LinearState
  createdAt: string
  completedAt: string | null
  canceledAt: string | null
  creator: UserNode | null
  parent: LinkNode | null
  relations: { nodes: { type: string; relatedIssue: LinkNode }[] }
  inverseRelations: { nodes: { type: string; issue: LinkNode }[] }
  labels: { nodes: { name: string }[] }
  projectMilestone: { name: string } | null
}

interface CommentNode {
  id: string
  body: string
  createdAt: string
  user: UserNode | null
  botActor: { name: string | null } | null
  parent: { id: string } | null
}

interface HistoryNode {
  createdAt: string
  actor: UserNode | null
  fromState: { name: string } | null
  toState: { name: string } | null
  fromTitle: string | null
  toTitle: string | null
  fromPriority: number | null
  toPriority: number | null
  fromEstimate: number | null
  toEstimate: number | null
  fromParent: LinkNode | null
  toParent: LinkNode | null
  addedLabels: { name: string }[] | null
  removedLabels: { name: string }[] | null
}

// Linear rejects a query whose estimated complexity is over 10000: a smaller page than the chain's for more lists a node.
const PAGE = 25
const LIST = 100
const LINK = 'id identifier'
const CLOSED_TYPES = new Set(['completed', 'canceled', 'duplicate'])

// Linear archives closed issues after a while: they are read too; an issue in the trash is not.
const ISSUES = `query($filter: IssueFilter!, $after: String) {
  issues(first: ${PAGE}, after: $after, filter: $filter, includeArchived: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ${LINK} number title description priority estimate trashed createdAt completedAt canceledAt
      state { name type }
      creator { id name }
      parent { ${LINK} }
      relations(first: 25) { nodes { type relatedIssue { ${LINK} } } }
      inverseRelations(first: 25) { nodes { type issue { ${LINK} } } }
      labels(first: 25) { nodes { name } }
      projectMilestone { name }
    }
  }
}`

const COMMENTS = `query($id: String!, $after: String) {
  issue(id: $id) {
    comments(first: ${LIST}, after: $after, includeArchived: true) {
      pageInfo { hasNextPage endCursor }
      nodes { id body createdAt user { id name } botActor { name } parent { id } }
    }
  }
}`

const ATTACHMENTS = `query($id: String!, $after: String) {
  issue(id: $id) { attachments(first: ${LIST}, after: $after) { pageInfo { hasNextPage endCursor } nodes { title url } } }
}`

/** Linear keeps a milestone in a project: the team's projects, each with its milestones. */
const MILESTONES = `query($team: String!) {
  team(id: $team) { projects(first: 50) { nodes { id projectMilestones(first: 50) { nodes { name targetDate description } } } } }
}`

interface MilestoneNode {
  name: string
  targetDate: string | null
  description: string | null
}

const HISTORY = `query($id: String!, $after: String) {
  issue(id: $id) {
    history(first: ${LIST}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        createdAt actor { id name }
        fromState { name } toState { name } fromTitle toTitle fromPriority toPriority fromEstimate toEstimate
        fromParent { ${LINK} } toParent { ${LINK} } addedLabels { name } removedLabels { name }
      }
    }
  }
}`

/**
 * The import's read of a Linear project (BTN-1404): every issue of its team or of its Linear project, closed, cancelled,
 * duplicates and archived ones too, its comments with their threads, the uploads of its texts and attachments, and its
 * history. Linear keeps no component and no time reports. The issues are read once, on the first call; comments a task
 * at a time, the last task's kept for its files.
 */
export function linearImport(deps: LinearImportDeps): ImportSource {
  const { graphql } = deps

  let loading: Promise<ImportTask[]> | null = null
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
      if (connection == null) throw new Error(`linear: ${what} not found or the key cannot see it`)
      out.push(...connection.nodes)
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    } while (after !== null)
    return out
  }

  const author = (user: UserNode | null | undefined, bot?: { name: string | null } | null): ImportAuthor | null => {
    if (user != null) return { kind: user.id === deps.viewer ? 'agent' : user.id === deps.user ? 'user' : 'person', name: user.name }
    return bot == null ? null : { kind: 'person', name: bot.name }
  }

  async function load(): Promise<ImportTask[]> {
    const read = await pages(ISSUES, { filter: deps.filter }, (data: { issues: Page<IssueNode> | null }) => data.issues, deps.place)
    // An issue in the trash is deleted: neither it nor a link to it moves.
    const trashed = new Set(read.filter((issue) => issue.trashed === true).map((issue) => issue.id))
    const issues = read.filter((issue) => !trashed.has(issue.id))
    const own = new Set(issues.map((issue) => issue.id))
    const link = (node: LinkNode): ImportLink => ({ ref: node.id, id: node.identifier, foreign: !own.has(node.id) })
    // Each side of a relation is read from both of its issues; a pair inside the project stands on both sides once.
    const blocks = new Map<string, Map<string, LinkNode>>()
    const blockedBy = new Map<string, Map<string, LinkNode>>()
    const related = new Map<string, Map<string, LinkNode>>()
    const put = (into: Map<string, Map<string, LinkNode>>, issue: LinkNode, other: LinkNode) => {
      if (!own.has(issue.id) || other.id === issue.id || trashed.has(other.id)) return
      const links = into.get(issue.id) ?? new Map<string, LinkNode>()
      links.set(other.id, other)
      into.set(issue.id, links)
    }
    const relate = (type: string, from: LinkNode, to: LinkNode) => {
      if (type === 'blocks') {
        put(blocks, from, to)
        put(blockedBy, to, from)
      } else if (type === 'related' || type === 'duplicate') {
        put(related, from, to)
        put(related, to, from)
      }
    }
    for (const issue of issues) {
      for (const relation of issue.relations.nodes) relate(relation.type, issue, relation.relatedIssue)
      for (const relation of issue.inverseRelations.nodes) relate(relation.type, relation.issue, issue)
    }
    const links = (from: Map<string, Map<string, LinkNode>>, issue: IssueNode) => [...(from.get(issue.id)?.values() ?? [])].map(link)
    const tasks = issues.map((issue): ImportTask => {
      const description = issue.description ?? ''
      return {
        ref: issue.id,
        number: issue.number,
        id: issue.identifier,
        title: issue.title,
        description,
        images: uploadsOf(description).map(imageOf),
        status: linearStatus(issue.state),
        priority: linearPriority(issue.priority),
        milestone: issue.projectMilestone?.name ?? null,
        component: null,
        labels: issue.labels.nodes.map((label) => label.name),
        estimate: linearMinutes(issue.estimate, deps.scale),
        parent: issue.parent === null || trashed.has(issue.parent.id) ? null : link(issue.parent),
        blocks: links(blocks, issue),
        blockedBy: links(blockedBy, issue),
        related: links(related, issue),
        createdAt: Date.parse(issue.createdAt),
        createdBy: author(issue.creator),
        closedAt: closedAt(issue),
        // Whether a comment or a file moves the issue's `updatedAt` was never seen: the last pass reads every task.
        modifiedAt: null,
      }
    })
    return tasks.sort((a, b) => a.number - b.number)
  }

  let thread: { ref: string; comments: Promise<CommentNode[]> } | null = null
  function commentsOf(ref: string): Promise<CommentNode[]> {
    if (thread?.ref === ref) return thread.comments
    const comments = pages(COMMENTS, { id: ref }, (data: { issue: { comments: Page<CommentNode> } | null }) => data.issue?.comments, `issue ${ref}`)
    thread = { ref, comments }
    comments.catch(() => {
      if (thread?.comments === comments) thread = null
    })
    return comments
  }

  async function taskOf(ref: string): Promise<ImportTask> {
    const task = (await project()).find((each) => each.ref === ref)
    if (task === undefined) throw new Error(`linear: issue ${ref} is not one of ${deps.place}`)
    return task
  }

  return {
    tasks: project,

    // A milestone has a target date and a description, no status: each is planned. A name of two projects comes once.
    milestoneGaps: ['status', 'closedAt'],
    async milestones() {
      type Projects = { team: { projects: { nodes: { id: string; projectMilestones: { nodes: MilestoneNode[] } }[] } } | null }
      const { team } = await graphql<Projects>(MILESTONES, { team: deps.team })
      if (team === null) throw new Error(`linear: ${deps.place} not found or the key cannot see it`)
      const out: ImportMilestone[] = []
      for (const node of team.projects.nodes.filter((each) => deps.project === undefined || each.id === deps.project).flatMap((each) => each.projectMilestones.nodes)) {
        if (out.some((each) => each.name.toLocaleLowerCase() === node.name.toLocaleLowerCase())) continue
        out.push({ name: node.name, date: node.targetDate === null ? null : Date.parse(node.targetDate), status: 'planned', description: node.description ?? '', closedAt: null })
      }
      return out
    },

    async comments(ref) {
      const nodes = await commentsOf(ref)
      return [...nodes]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map((node): ImportComment => {
          const uploads = uploadsOf(node.body)
          return {
            ref: node.id,
            author: author(node.user, node.botActor),
            at: Date.parse(node.createdAt),
            body: node.body,
            images: uploads.map(imageOf),
            files: uploads.map((upload) => upload.key),
            replyTo: node.parent?.id ?? null,
          }
        })
    },

    async files(ref) {
      const [task, nodes, attachments] = await Promise.all([
        taskOf(ref),
        commentsOf(ref),
        pages(ATTACHMENTS, { id: ref }, (data: { issue: { attachments: Page<LinearAttachment> } | null }) => data.issue?.attachments, `issue ${ref}`),
      ])
      // An attachment is mostly a link to elsewhere (a pull request, a thread): only an upload of Linear's is a file.
      const uploaded = attachments.filter((each) => LINEAR_UPLOADS.test(each.url)).map((each): Upload => ({ key: each.url, name: each.title, link: each.url }))
      const files = new Map<string, ImportFile>()
      for (const upload of [...uploadsOf(task.description), ...uploaded, ...nodes.flatMap((node) => uploadsOf(node.body))]) {
        if (files.has(upload.key)) continue
        // Linear names no type before the download: the file takes the one it is served with.
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
      const nodes = await pages(HISTORY, { id: ref }, (data: { issue: { history: Page<HistoryNode> } | null }) => data.issue?.history, `issue ${ref}`)
      return changesOf(nodes, deps.scale).map((change) => ({ ...change, author: author(change.author) }))
    },
  }
}

/** When it went into its closed state: Linear keeps the completion and the cancellation apart; `null` — it is open. */
function closedAt(issue: IssueNode): number | null {
  if (!CLOSED_TYPES.has(issue.state.type)) return null
  const at = issue.state.type === 'completed' ? (issue.completedAt ?? issue.canceledAt) : (issue.canceledAt ?? issue.completedAt)
  return at === null ? null : Date.parse(at)
}

interface Upload {
  key: string
  link: string
  name: string
}

/** The files uploaded into a text, each once, keyed by the upload's link. */
function uploadsOf(text: string): Upload[] {
  return linkedFiles(text, LINEAR_UPLOADS).map(({ name, file }) => ({ key: file, link: file, name }))
}

// Every upload link, a file's as a picture's, stands at its own address: the import points it at the attachment.
const imageOf = (upload: Upload): ImportImage => ({ ref: upload.link, file: upload.key })

type Change = Omit<ImportChange, 'author'> & { author: UserNode | null }

const priorityOf = (value: number | null): string | null => {
  const level = value === null ? 'none' : linearPriority(value)
  return level === 'none' ? null : level
}

/**
 * The history as the change log, oldest first: one entry of Linear's carries every field it changed, each a change
 * here. The milestone and the relations are not read: their history is not checked against the schema.
 */
function changesOf(nodes: readonly HistoryNode[], scale: readonly number[] | null): Change[] {
  const out: Change[] = []
  const minutes = (points: number | null) => {
    const value = linearMinutes(points, scale)
    return value === null ? null : String(value)
  }
  for (const node of [...nodes].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    const at = Date.parse(node.createdAt)
    const push = (field: Change['field'], from: string | null, to: string | null) => {
      if (from !== to) out.push({ at, author: node.actor, field, from, to })
    }
    if (node.fromState !== null && node.toState !== null) push('status', node.fromState.name, node.toState.name)
    if (node.toTitle !== null && node.fromTitle !== null) push('title', node.fromTitle, node.toTitle)
    if (node.fromPriority !== null || node.toPriority !== null) push('priority', priorityOf(node.fromPriority), priorityOf(node.toPriority))
    if (node.fromEstimate !== null || node.toEstimate !== null) push('estimate', minutes(node.fromEstimate), minutes(node.toEstimate))
    if (node.fromParent !== null || node.toParent !== null) push('parent', node.fromParent?.identifier ?? null, node.toParent?.identifier ?? null)
    for (const label of node.addedLabels ?? []) push('label', null, label.name)
    for (const label of node.removedLabels ?? []) push('label', label.name, null)
  }
  return out
}
