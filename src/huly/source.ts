import { createRequire } from 'node:module'
import type { TrackerTask } from '../tracker/model.js'
import type { TaskSource } from '../tracker/source.js'
import { authOf, type HulyCredentials } from './credentials.js'
import { quietModelNoise } from './quiet.js'
import {
  cardLinks,
  closingStatus,
  hulyPriority,
  ISSUE_CLASS,
  labeled,
  latestMessages,
  milestonesOf,
  missingBlockers,
  readyStatus,
  toCard,
  toStatus,
  todoStatus,
  toTasks,
  vocabularyOf,
  type HulyAttachmentDoc,
  type HulyCardIssue,
  type HulyIssueDoc,
  type HulyLabelDoc,
  type HulyMilestoneDoc,
  type HulyStatusDoc,
} from './model.js'

type Query = Record<string, unknown>
type FullIssue = HulyCardIssue & { space: string; description?: string | null }

interface ChatMessageDoc {
  _id: string
  message: string
  createdBy?: string
  createdOn: number
}

interface PlatformClient {
  findAll<T>(cls: string, query: Query, options?: { projection?: Record<string, 1> }): Promise<T[]>
  findOne<T>(cls: string, query: Query, options?: { sort?: Record<string, 1 | -1> }): Promise<T | undefined>
  updateDoc(cls: string, space: string, id: string, update: Record<string, unknown>, retrieve?: boolean): Promise<unknown>
  addCollection(
    cls: string,
    space: string,
    attachedTo: string,
    attachedToClass: string,
    collection: string,
    attributes: Record<string, unknown>,
    id?: string,
  ): Promise<string>
  fetchMarkup(cls: string, id: string, attribute: string, markup: string, format: 'markdown'): Promise<string>
  uploadMarkup(cls: string, id: string, attribute: string, markup: string, format: 'markdown'): Promise<string>
  close(): Promise<void>
}

interface StorageClient {
  get(file: string): Promise<AsyncIterable<Uint8Array>>
}

interface ApiClientModule {
  connect(url: string, options: Record<string, unknown>): Promise<PlatformClient>
  connectStorage(url: string, options: Record<string, unknown>): Promise<StorageClient>
  NodeWebSocketFactory: unknown
}

interface TrackerPlugin {
  class: { Issue: string; IssueStatus: string; Milestone: string; Project: string }
  ids: { NoParent: string }
  taskTypes: { Issue: string }
}

const require = createRequire(import.meta.url)
const api = require('@hcengineering/api-client') as ApiClientModule
const tracker = (require('@hcengineering/tracker') as { default: TrackerPlugin }).default
const { generateId } = require('@hcengineering/core') as { generateId(): string }
const { makeRank } = require('@hcengineering/rank') as { makeRank(prev: string | undefined, next: string | undefined): string }

const { markupToJSON, jsonToMarkup } = require('@hcengineering/text-core') as {
  markupToJSON(markup: string): unknown
  jsonToMarkup(json: unknown): string
}
const { markupToMarkdown, markdownToMarkup } = require('@hcengineering/text-markdown') as {
  markupToMarkdown(markup: unknown): string
  markdownToMarkup(markdown: string): unknown
}

const TAG_REFERENCE = 'tags:class:TagReference'
const TAG_ELEMENT = 'tags:class:TagElement'
const PROJECT_TYPE = 'task:class:ProjectType'
const CHAT_MESSAGE = 'chunter:class:ChatMessage'
const ATTACHMENT = 'attachment:class:Attachment'
const SOCIAL_IDENTITY = 'contact:class:SocialIdentity'
const PERSON = 'contact:class:Person'
const SPACE_OF_SPACES = 'core:space:Space'
const REF_FIELDS = { identifier: 1, title: 1, status: 1 } as const

const ISSUE_FIELDS = {
  identifier: 1,
  title: 1,
  status: 1,
  blockedBy: 1,
  parents: 1,
  milestone: 1,
  priority: 1,
  subIssues: 1,
  labels: 1,
  estimation: 1,
} as const
const MILESTONE_FIELDS = { label: 1, targetDate: 1 } as const
/** Huly's `MilestoneStatus.Completed` and `Canceled`. */
const CLOSED_MILESTONES = [2, 3]
const LABEL_FIELDS = { attachedTo: 1, title: 1 } as const
const ATTACHMENT_FIELDS = { attachedTo: 1, file: 1, name: 1, type: 1, size: 1, modifiedOn: 1, createdOn: 1 } as const

export interface HulySource extends TaskSource {
  /** The internal `_id` of each project read so far, by its identifier: the project's page is addressed by it. */
  projectIds: ReadonlyMap<string, string>
}

export async function connectHuly(credentials: HulyCredentials, timeoutMs: number): Promise<HulySource> {
  const account = authOf(credentials)
  quietModelNoise()
  const client = await api.connect(credentials.url, {
    ...account,
    socketFactory: api.NodeWebSocketFactory,
    connectionTimeout: timeoutMs,
  })

  const findStatuses = () => client.findAll<HulyStatusDoc>(tracker.class.IssueStatus, {})
  const findIssues = (query: Query) => client.findAll<HulyIssueDoc>(tracker.class.Issue, query, { projection: ISSUE_FIELDS })
  const findAttachments = (query: Query) => client.findAll<HulyAttachmentDoc>(ATTACHMENT, query, { projection: ATTACHMENT_FIELDS })

  let storage: Promise<StorageClient> | null = null
  // The storage token may expire while the service runs: a failed read connects anew once.
  async function readFile(file: string): Promise<AsyncIterable<Uint8Array>> {
    for (let attempt = 0; ; attempt++) {
      storage ??= api.connectStorage(credentials.url, account)
      try {
        return await (await storage).get(file)
      } catch (error) {
        storage = null
        if (attempt > 0) throw error
      }
    }
  }

  async function findIssue(identifier: string): Promise<FullIssue> {
    const issue = await client.findOne<FullIssue>(tracker.class.Issue, { identifier })
    if (issue === undefined) throw new Error(`huly: issue ${identifier} not found`)
    return issue
  }

  async function projectStatuses(space: string): Promise<string[] | null> {
    const project = await client.findOne<{ type?: string }>(tracker.class.Project, { _id: space })
    if (project?.type === undefined) return null
    const type = await client.findOne<{ statuses?: { _id: string }[] }>(PROJECT_TYPE, { _id: project.type })
    return type?.statuses?.map((status) => status._id) ?? null
  }

  async function peopleOf(socialIds: string[]): Promise<Map<string, string>> {
    if (socialIds.length === 0) return new Map()
    const identities = await client.findAll<{ _id: string; attachedTo: string }>(
      SOCIAL_IDENTITY,
      { _id: { $in: [...new Set(socialIds)] } },
      { projection: { attachedTo: 1 } },
    )
    const persons = await client.findAll<{ _id: string; name: string }>(
      PERSON,
      { _id: { $in: [...new Set(identities.map((doc) => doc.attachedTo))] } },
      { projection: { name: 1 } },
    )
    const nameOf = new Map(persons.map((doc) => [doc._id, doc.name]))
    return new Map(identities.flatMap((doc) => (nameOf.has(doc.attachedTo) ? [[doc._id, nameOf.get(doc.attachedTo)!]] : [])))
  }

  async function resolve(issues: HulyIssueDoc[], statuses: HulyStatusDoc[]): Promise<TrackerTask[]> {
    const missing = missingBlockers(issues)
    const planned = milestonesOf(issues)
    const tagged = labeled(issues)
    const [blockers, milestones, labels] = await Promise.all([
      missing.length === 0
        ? []
        : client.findAll<HulyIssueDoc>(tracker.class.Issue, { _id: { $in: missing } }, { projection: { identifier: 1 } }),
      planned.length === 0
        ? []
        : client.findAll<HulyMilestoneDoc>(tracker.class.Milestone, { _id: { $in: planned } }, { projection: MILESTONE_FIELDS }),
      tagged.length === 0
        ? []
        : client.findAll<HulyLabelDoc>(TAG_REFERENCE, { attachedTo: { $in: tagged } }, { projection: LABEL_FIELDS }),
    ])
    return toTasks(issues, statuses, new Map(blockers.map((doc) => [doc._id, doc.identifier])), milestones, labels)
  }

  const projectIds = new Map<string, string>()

  return {
    projectIds,

    async chainTasks(project, open) {
      const space = await client.findOne<{ _id: string }>(tracker.class.Project, { identifier: project })
      if (space === undefined) throw new Error(`huly: project ${project} not found`)
      projectIds.set(project, space._id)
      const statuses = await findStatuses()
      const opened = statuses.filter((doc) => open(toStatus(doc))).map((doc) => doc._id)
      const openIssues = await findIssues({ space: space._id, status: { $in: opened } })
      const milestones = milestonesOf(openIssues.filter((issue) => (issue.subIssues ?? 0) === 0))
      const closedIssues =
        milestones.length === 0 ? [] : await findIssues({ space: space._id, milestone: { $in: milestones }, status: { $nin: opened } })
      const tasks = await resolve([...openIssues, ...closedIssues], statuses)
      return { tasks, statuses: statuses.map((doc) => doc.name) }
    },
    async tasks(identifiers) {
      const [issues, statuses] = await Promise.all([findIssues({ identifier: { $in: identifiers } }), findStatuses()])
      return resolve(issues, statuses)
    },
    async brief(identifier) {
      const issue = await findIssue(identifier)
      const description = issue.description
        ? await client.fetchMarkup(tracker.class.Issue, issue._id, 'description', issue.description, 'markdown')
        : ''
      return { title: issue.title, description }
    },
    async complete(identifier) {
      const issue = await findIssue(identifier)
      const [statuses, allowed] = await Promise.all([findStatuses(), projectStatuses(issue.space)])
      const status = closingStatus(issue.status, statuses, allowed)
      if (status === null) return false
      await client.updateDoc(tracker.class.Issue, issue.space, issue._id, { status })
      return true
    },
    async children(identifier) {
      const issue = await findIssue(identifier)
      const [issues, statuses] = await Promise.all([findIssues({ attachedTo: issue._id }), findStatuses()])
      return resolve(issues, statuses)
    },
    async card(identifier) {
      const issue = await findIssue(identifier)
      const links = cardLinks(issue)
      const [description, statuses, linked, blocked, milestones, labels, messages] = await Promise.all([
        issue.description ? client.fetchMarkup(tracker.class.Issue, issue._id, 'description', issue.description, 'markdown') : '',
        findStatuses(),
        links.length === 0 ? [] : client.findAll<HulyIssueDoc>(tracker.class.Issue, { _id: { $in: links } }, { projection: REF_FIELDS }),
        client.findAll<HulyIssueDoc>(tracker.class.Issue, { blockedBy: { _id: issue._id, _class: ISSUE_CLASS } }, { projection: REF_FIELDS }),
        issue.milestone
          ? client.findAll<HulyMilestoneDoc>(tracker.class.Milestone, { _id: issue.milestone }, { projection: MILESTONE_FIELDS })
          : [],
        client.findAll<HulyLabelDoc>(TAG_REFERENCE, { attachedTo: issue._id }, { projection: LABEL_FIELDS }),
        client.findAll<ChatMessageDoc>(CHAT_MESSAGE, { attachedTo: issue._id }),
      ])
      const [people, attachments] = await Promise.all([
        peopleOf(messages.flatMap((doc) => doc.createdBy ?? [])),
        findAttachments({ attachedTo: { $in: [issue._id, ...messages.map((doc) => doc._id)] } }),
      ])
      return toCard({
        issue,
        description,
        statuses,
        linked: [...linked, ...blocked],
        blocks: blocked.map((doc) => doc._id),
        milestones,
        labels,
        comments: messages.map((doc) => ({ createdBy: doc.createdBy, createdOn: doc.createdOn, text: markupToMarkdown(markupToJSON(doc.message)) })),
        people,
        attachments,
      })
    },
    async file(identifier, file) {
      const issue = await findIssue(identifier)
      const messages = await client.findAll<{ _id: string }>(CHAT_MESSAGE, { attachedTo: issue._id }, { projection: { _id: 1 } })
      const [doc] = await findAttachments({ attachedTo: { $in: [issue._id, ...messages.map((each) => each._id)] }, file })
      if (doc === undefined) return null
      return { type: doc.type ?? '', size: doc.size ?? null, body: await readFile(file) }
    },
    async ready(identifier) {
      const issue = await findIssue(identifier)
      const [statuses, allowed] = await Promise.all([findStatuses(), projectStatuses(issue.space)])
      const status = readyStatus(issue.status, statuses, allowed)
      if (status === null) return null
      await client.updateDoc(tracker.class.Issue, issue.space, issue._id, { status: status._id })
      return toStatus(status)
    },
    async comment(identifier, body) {
      const issue = await findIssue(identifier)
      const message = jsonToMarkup(markdownToMarkup(body))
      return client.addCollection(CHAT_MESSAGE, issue.space, issue._id, tracker.class.Issue, 'comments', { message, attachments: 0 })
    },
    async commentsAfter(identifier, after) {
      const issue = await findIssue(identifier)
      const question = await client.findOne<ChatMessageDoc>(CHAT_MESSAGE, { _id: after })
      if (question === undefined) return []
      const messages = (await client.findAll<ChatMessageDoc>(CHAT_MESSAGE, { attachedTo: issue._id, createdOn: { $gt: question.createdOn } })).sort(
        (a, b) => a.createdOn - b.createdOn,
      )
      const attachments = messages.length === 0 ? [] : await findAttachments({ attachedTo: { $in: messages.map((doc) => doc._id) } })
      return messages.map((doc) => ({
        id: doc._id,
        body: markupToMarkdown(markupToJSON(doc.message)),
        files: attachments.filter((each) => each.attachedTo === doc._id).map((each) => ({ name: each.name, file: each.file })),
      }))
    },
    async create(task) {
      const space = await client.findOne<{ _id: string; identifier: string }>(tracker.class.Project, { identifier: task.project })
      if (space === undefined) throw new Error(`huly: project ${task.project} not found`)
      const [statuses, allowed, last, source] = await Promise.all([
        findStatuses(),
        projectStatuses(space._id),
        client.findOne<{ rank?: string }>(tracker.class.Issue, { space: space._id }, { sort: { rank: -1 } }),
        task.milestoneOf === null ? undefined : client.findOne<{ milestone?: string | null }>(tracker.class.Issue, { identifier: task.milestoneOf }),
      ])
      const status = todoStatus(statuses, allowed)
      // The project's issue counter is taken the way Huly's own client takes it.
      const taken = (await client.updateDoc(tracker.class.Project, SPACE_OF_SPACES, space._id, { $inc: { sequence: 1 } }, true)) as { object?: { sequence?: number } }
      const number = taken.object?.sequence
      if (number === undefined) throw new Error(`huly: project ${task.project} gave no issue number`)
      const id = generateId()
      const identifier = `${space.identifier}-${number}`
      const description = await client.uploadMarkup(tracker.class.Issue, id, 'description', task.description, 'markdown')
      await client.addCollection(
        tracker.class.Issue,
        space._id,
        tracker.ids.NoParent,
        tracker.class.Issue,
        'subIssues',
        {
          title: task.title,
          description,
          status: status._id,
          number,
          kind: tracker.taskTypes.Issue,
          identifier,
          priority: hulyPriority(task.priority),
          assignee: null,
          component: null,
          milestone: source?.milestone ?? null,
          estimation: 0,
          remainingTime: 0,
          reportedTime: 0,
          reports: 0,
          subIssues: 0,
          parents: [],
          childInfo: [],
          dueDate: null,
          rank: makeRank(last?.rank, undefined),
        },
        id,
      )
      return identifier
    },
    async setMilestone(identifier, milestoneOf) {
      const [issue, like] = await Promise.all([findIssue(identifier), findIssue(milestoneOf)])
      if (issue.milestone || !like.milestone || like.space !== issue.space) return false
      await client.updateDoc(tracker.class.Issue, issue.space, issue._id, { milestone: like.milestone })
      return true
    },
    async milestones(identifier) {
      const issue = await findIssue(identifier)
      const [open, own] = await Promise.all([
        client.findAll<HulyMilestoneDoc>(tracker.class.Milestone, { space: issue.space, status: { $nin: CLOSED_MILESTONES } }, { projection: MILESTONE_FIELDS }),
        issue.milestone ? client.findAll<HulyMilestoneDoc>(tracker.class.Milestone, { _id: issue.milestone }, { projection: MILESTONE_FIELDS }) : [],
      ])
      const choices = [...open, ...own.filter((doc) => !open.some((each) => each._id === doc._id))]
      return {
        current: issue.milestone || null,
        choices: choices.map((doc) => ({ id: doc._id, label: doc.label, targetDate: doc.targetDate || null })),
      }
    },
    async moveMilestone(identifier, milestone) {
      const issue = await findIssue(identifier)
      if (milestone !== null && (await client.findOne(tracker.class.Milestone, { _id: milestone, space: issue.space })) === undefined) {
        throw new Error(`huly: milestone ${milestone} is not in the project of ${identifier}`)
      }
      await client.updateDoc(tracker.class.Issue, issue.space, issue._id, { milestone })
    },
    async milestoneTasks(project, milestone) {
      const space = await client.findOne<{ _id: string }>(tracker.class.Project, { identifier: project })
      if (space === undefined) throw new Error(`huly: project ${project} not found`)
      const milestones = await client.findAll<{ _id: string }>(tracker.class.Milestone, { space: space._id, label: milestone }, { projection: { _id: 1 } })
      if (milestones.length === 0) return []
      const [issues, statuses] = await Promise.all([findIssues({ space: space._id, milestone: { $in: milestones.map((doc) => doc._id) } }), findStatuses()])
      if (issues.length === 0) return []
      const [tasks, messages] = await Promise.all([
        resolve(issues, statuses),
        client.findAll<ChatMessageDoc & { attachedTo: string }>(
          CHAT_MESSAGE,
          { attachedTo: { $in: issues.map((issue) => issue._id) } },
          { projection: { attachedTo: 1, message: 1, createdOn: 1 } },
        ),
      ])
      const latest = latestMessages(messages)
      const idOf = new Map(issues.map((issue) => [issue.identifier, issue._id]))
      return tasks.map((task) => {
        const markup = latest.get(idOf.get(task.id) ?? '')
        return { ...task, lastComment: markup === undefined ? null : markupToMarkdown(markupToJSON(markup)) }
      })
    },
    async vocabulary(project) {
      const space = await client.findOne<{ _id: string }>(tracker.class.Project, { identifier: project })
      if (space === undefined) throw new Error(`huly: project ${project} not found`)
      const [statuses, allowed, tags] = await Promise.all([
        findStatuses(),
        projectStatuses(space._id),
        client.findAll<{ title: string }>(TAG_ELEMENT, { targetClass: tracker.class.Issue }, { projection: { title: 1 } }),
      ])
      return vocabularyOf(statuses, allowed, tags)
    },
    close: () => client.close(),
  }
}
