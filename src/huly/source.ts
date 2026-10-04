import { createRequire } from 'node:module'
import type { TrackerTask } from '../tracker/model.js'
import type { TaskSource } from '../tracker/source.js'
import type { HulyCredentials } from './credentials.js'
import {
  closingStatus,
  labeled,
  milestonesOf,
  missingBlockers,
  toStatus,
  toTasks,
  type HulyIssueDoc,
  type HulyLabelDoc,
  type HulyMilestoneDoc,
  type HulyStatusDoc,
} from './model.js'

type Query = Record<string, unknown>
type FullIssue = HulyIssueDoc & { space: string; description?: string | null }

interface PlatformClient {
  findAll<T>(cls: string, query: Query, options?: { projection?: Record<string, 1> }): Promise<T[]>
  findOne<T>(cls: string, query: Query): Promise<T | undefined>
  updateDoc(cls: string, space: string, id: string, update: Record<string, unknown>): Promise<unknown>
  fetchMarkup(cls: string, id: string, attribute: string, markup: string, format: 'markdown'): Promise<string>
  close(): Promise<void>
}

interface ApiClientModule {
  connect(url: string, options: Record<string, unknown>): Promise<PlatformClient>
  NodeWebSocketFactory: unknown
}

interface TrackerPlugin {
  class: { Issue: string; IssueStatus: string; Milestone: string; Project: string }
}

const require = createRequire(import.meta.url)
const api = require('@hcengineering/api-client') as ApiClientModule
const tracker = (require('@hcengineering/tracker') as { default: TrackerPlugin }).default

const TAG_REFERENCE = 'tags:class:TagReference'
const PROJECT_TYPE = 'task:class:ProjectType'

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
const LABEL_FIELDS = { attachedTo: 1, title: 1 } as const

export async function connectHuly(credentials: HulyCredentials, timeoutMs: number): Promise<TaskSource> {
  const client = await api.connect(credentials.url, {
    email: credentials.email,
    password: credentials.password,
    workspace: credentials.workspace,
    socketFactory: api.NodeWebSocketFactory,
    connectionTimeout: timeoutMs,
  })

  const findStatuses = () => client.findAll<HulyStatusDoc>(tracker.class.IssueStatus, {})
  const findIssues = (query: Query) => client.findAll<HulyIssueDoc>(tracker.class.Issue, query, { projection: ISSUE_FIELDS })

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

  return {
    async chainTasks(project, open) {
      const space = await client.findOne<{ _id: string }>(tracker.class.Project, { identifier: project })
      if (space === undefined) throw new Error(`huly: project ${project} not found`)
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
    close: () => client.close(),
  }
}
