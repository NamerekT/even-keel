import { createRequire } from 'node:module'
import { isTerminal, unknownStatuses, type ChainRules } from '../chain/rules.js'
import type { HulyCredentials } from './credentials.js'
import {
  labeled,
  milestonesOf,
  missingBlockers,
  toStatus,
  toTasks,
  withoutParents,
  type HulyIssueDoc,
  type HulyLabelDoc,
  type HulyMilestoneDoc,
  type HulyStatusDoc,
  type HulyTask,
} from './model.js'

export interface ChainTasks {
  tasks: HulyTask[]
  unknownStatuses: string[]
}

export interface HulySource {
  chainTasks(project: string, rules: ChainRules): Promise<ChainTasks>
  tasks(identifiers: string[]): Promise<HulyTask[]>
  close(): Promise<void>
}

type Query = Record<string, unknown>

interface PlatformClient {
  findAll<T>(cls: string, query: Query, options?: { projection?: Record<string, 1> }): Promise<T[]>
  findOne<T>(cls: string, query: Query): Promise<T | undefined>
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

const ISSUE_FIELDS = { identifier: 1, title: 1, status: 1, blockedBy: 1, milestone: 1, subIssues: 1, labels: 1 } as const
const MILESTONE_FIELDS = { label: 1, targetDate: 1 } as const
const LABEL_FIELDS = { attachedTo: 1, title: 1 } as const

export async function connectHuly(credentials: HulyCredentials, timeoutMs: number): Promise<HulySource> {
  const client = await api.connect(credentials.url, {
    email: credentials.email,
    password: credentials.password,
    workspace: credentials.workspace,
    socketFactory: api.NodeWebSocketFactory,
    connectionTimeout: timeoutMs,
  })

  const findStatuses = () => client.findAll<HulyStatusDoc>(tracker.class.IssueStatus, {})
  const findIssues = (query: Query) => client.findAll<HulyIssueDoc>(tracker.class.Issue, query, { projection: ISSUE_FIELDS })

  async function resolve(issues: HulyIssueDoc[], statuses: HulyStatusDoc[]): Promise<HulyTask[]> {
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
    async chainTasks(project, rules) {
      const space = await client.findOne<{ _id: string }>(tracker.class.Project, { identifier: project })
      if (space === undefined) throw new Error(`huly: project ${project} not found`)
      const statuses = await findStatuses()
      const open = statuses.filter((doc) => !isTerminal(rules, toStatus(doc))).map((doc) => doc._id)
      const openIssues = withoutParents(await findIssues({ space: space._id, status: { $in: open } }))
      const milestones = milestonesOf(openIssues)
      const closedIssues =
        milestones.length === 0
          ? []
          : withoutParents(await findIssues({ space: space._id, milestone: { $in: milestones }, status: { $nin: open } }))
      const tasks = await resolve([...openIssues, ...closedIssues], statuses)
      return { tasks, unknownStatuses: unknownStatuses(rules, statuses.map((doc) => doc.name)) }
    },
    async tasks(identifiers) {
      const [issues, statuses] = await Promise.all([findIssues({ identifier: { $in: identifiers } }), findStatuses()])
      return resolve(issues, statuses)
    },
    close: () => client.close(),
  }
}
