import { createRequire } from 'node:module'
import type { HulyCredentials } from './credentials.js'
import { isOpen, missingBlockers, toStatus, toTasks, type HulyIssueDoc, type HulyStatusDoc, type HulyTask } from './model.js'

export interface HulySource {
  openTasks(project: string): Promise<HulyTask[]>
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
  class: { Issue: string; IssueStatus: string; Project: string }
}

const require = createRequire(import.meta.url)
const api = require('@hcengineering/api-client') as ApiClientModule
const tracker = (require('@hcengineering/tracker') as { default: TrackerPlugin }).default

const ISSUE_FIELDS = { identifier: 1, title: 1, status: 1, blockedBy: 1 } as const

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
    const blockers =
      missing.length === 0
        ? []
        : await client.findAll<HulyIssueDoc>(tracker.class.Issue, { _id: { $in: missing } }, { projection: { identifier: 1 } })
    return toTasks(issues, statuses, new Map(blockers.map((doc) => [doc._id, doc.identifier])))
  }

  return {
    async openTasks(project) {
      const space = await client.findOne<{ _id: string }>(tracker.class.Project, { identifier: project })
      if (space === undefined) throw new Error(`huly: project ${project} not found`)
      const statuses = await findStatuses()
      const open = statuses.filter((doc) => isOpen(toStatus(doc))).map((doc) => doc._id)
      return resolve(await findIssues({ space: space._id, status: { $in: open } }), statuses)
    },
    async tasks(identifiers) {
      const [issues, statuses] = await Promise.all([findIssues({ identifier: { $in: identifiers } }), findStatuses()])
      return resolve(issues, statuses)
    },
    close: () => client.close(),
  }
}
