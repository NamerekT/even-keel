import { createRequire } from 'node:module'
import type { HulyCredentials } from '../../src/huly/credentials.js'

export interface TaskRecord {
  task: string
  title: string
  status: string | null
  labels: string[]
  related: string[]
  priority: string | null
  estimateH: number | null
  component: string | null
  done: boolean | null
}

interface IssueDoc {
  _id: string
  identifier: string
  title: string
  status: string
  relations?: { _id: string }[]
  priority?: number
  estimation?: number
  component?: string | null
}

interface StatusDoc {
  _id: string
  name: string
  category?: string
}

interface ComponentDoc {
  _id: string
  label: string
}

interface LabelDoc {
  attachedTo: string
  title: string
}

interface PlatformClient {
  findAll<T>(cls: string, query: Record<string, unknown>, options?: { projection?: Record<string, 1> }): Promise<T[]>
  addCollection(
    cls: string,
    space: string,
    attachedTo: string,
    attachedToClass: string,
    collection: string,
    data: Record<string, unknown>,
  ): Promise<string>
  close(): Promise<void>
}

interface TrackerModule {
  default: { class: { Issue: string; IssueStatus: string; Component: string; TimeSpendReport: string } }
}

export interface TimeReport {
  task: string
  hours: number
  date: string
}

interface ReportDoc {
  attachedTo: string
  value: number
  description: string
}

interface ApiClientModule {
  connect(url: string, options: Record<string, unknown>): Promise<PlatformClient>
  NodeWebSocketFactory: unknown
}

const require = createRequire(import.meta.url)
const TAG_REFERENCE = 'tags:class:TagReference'
const WON = 'task:statusCategory:Won'
const PRIORITIES = ['no-priority', 'urgent', 'high', 'medium', 'low']
const MODEL_NOISE = /^no document found, failed to apply model transaction/
export const REPORT_DESCRIPTION = 'Tally: активное время агента по ходам транскриптов'

export async function fetchTasks(credentials: HulyCredentials, identifiers: string[], timeoutMs: number): Promise<TaskRecord[]> {
  const tracker = (require('@hcengineering/tracker') as TrackerModule).default
  const ISSUE = tracker.class.Issue
  const ISSUE_STATUS = tracker.class.IssueStatus
  const client = await connect(credentials, timeoutMs)
  try {
    const issues = await client.findAll<IssueDoc>(
      ISSUE,
      { identifier: { $in: identifiers } },
      { projection: { identifier: 1, title: 1, status: 1, relations: 1, priority: 1, estimation: 1, component: 1 } },
    )
    const ids = issues.map((issue) => issue._id)
    const unknown = unknownRelations(issues)
    const componentIds = [...new Set(issues.flatMap((issue) => issue.component ?? []))]
    const [statuses, labels, others, components] = await Promise.all([
      client.findAll<StatusDoc>(ISSUE_STATUS, {}),
      ids.length === 0 ? [] : client.findAll<LabelDoc>(TAG_REFERENCE, { attachedTo: { $in: ids } }, { projection: { attachedTo: 1, title: 1 } }),
      unknown.length === 0 ? [] : client.findAll<IssueDoc>(ISSUE, { _id: { $in: unknown } }, { projection: { identifier: 1 } }),
      componentIds.length === 0 ? [] : client.findAll<ComponentDoc>(tracker.class.Component, { _id: { $in: componentIds } }),
    ])
    return taskRecords(issues, statuses, labels, new Map(others.map((doc) => [doc._id, doc.identifier])), components)
  } finally {
    await client.close()
  }
}

// One Tally report per issue: an issue that already has one keeps it, whatever its value.
export async function reportTimes(credentials: HulyCredentials, reports: TimeReport[], timeoutMs: number): Promise<Map<string, number>> {
  const tracker = (require('@hcengineering/tracker') as TrackerModule).default
  const client = await connect(credentials, timeoutMs)
  try {
    const issues = await client.findAll<IssueDoc & { space: string }>(
      tracker.class.Issue,
      { identifier: { $in: reports.map((report) => report.task) } },
      { projection: { identifier: 1, space: 1 } },
    )
    const byTask = new Map(issues.map((issue) => [issue.identifier, issue]))
    const existing = await client.findAll<ReportDoc>(tracker.class.TimeSpendReport, {
      attachedTo: { $in: issues.map((issue) => issue._id) },
      description: REPORT_DESCRIPTION,
    })
    const reported = new Map(existing.map((doc) => [doc.attachedTo, doc.value]))
    const done = new Map<string, number>()
    for (const report of reports) {
      const issue = byTask.get(report.task)
      if (issue === undefined) continue
      const already = reported.get(issue._id)
      if (already !== undefined) {
        done.set(report.task, already)
        continue
      }
      await client.addCollection(tracker.class.TimeSpendReport, issue.space, issue._id, tracker.class.Issue, 'reports', {
        employee: null,
        date: Date.parse(report.date),
        value: report.hours,
        description: REPORT_DESCRIPTION,
      })
      done.set(report.task, report.hours)
    }
    return done
  } finally {
    await client.close()
  }
}

async function connect(credentials: HulyCredentials, timeoutMs: number): Promise<PlatformClient> {
  const api = require('@hcengineering/api-client') as ApiClientModule
  return await withoutModelNoise(() =>
    api.connect(credentials.url, {
      email: credentials.email,
      password: credentials.password,
      workspace: credentials.workspace,
      socketFactory: api.NodeWebSocketFactory,
      connectionTimeout: timeoutMs,
    }),
  )
}

async function withoutModelNoise<T>(work: () => Promise<T>): Promise<T> {
  const methods = ['log', 'info', 'warn'] as const
  const original = methods.map((name) => console[name])
  methods.forEach((name, index) => {
    console[name] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && MODEL_NOISE.test(args[0])) return
      original[index]!(...args)
    }
  })
  try {
    return await work()
  } finally {
    methods.forEach((name, index) => (console[name] = original[index]!))
  }
}

export function unknownRelations(issues: IssueDoc[]): string[] {
  const fetched = new Set(issues.map((issue) => issue._id))
  return [...new Set(issues.flatMap((issue) => (issue.relations ?? []).map((ref) => ref._id)))].filter((id) => !fetched.has(id))
}

export function taskRecords(
  issues: IssueDoc[],
  statuses: StatusDoc[],
  labels: LabelDoc[],
  others: ReadonlyMap<string, string>,
  components: ComponentDoc[] = [],
): TaskRecord[] {
  const statusById = new Map(statuses.map((doc) => [doc._id, doc]))
  const componentById = new Map(components.map((doc) => [doc._id, doc.label]))
  const identifierById = new Map(others)
  for (const issue of issues) identifierById.set(issue._id, issue.identifier)
  const related = new Map<string, Set<string>>(issues.map((issue) => [issue._id, new Set()]))
  for (const issue of issues) {
    for (const ref of issue.relations ?? []) {
      related.get(issue._id)!.add(ref._id)
      related.get(ref._id)?.add(issue._id)
    }
  }
  const labelsById = new Map<string, Map<string, string>>()
  for (const doc of labels) {
    const own = labelsById.get(doc.attachedTo) ?? new Map<string, string>()
    const title = doc.title.trim()
    if (!own.has(title.toLocaleLowerCase())) own.set(title.toLocaleLowerCase(), title)
    labelsById.set(doc.attachedTo, own)
  }
  return issues.map((issue) => ({
    task: issue.identifier,
    title: issue.title,
    status: statusById.get(issue.status)?.name ?? null,
    labels: [...(labelsById.get(issue._id)?.values() ?? [])],
    related: [...related.get(issue._id)!].flatMap((id) => identifierById.get(id) ?? []),
    priority: PRIORITIES[issue.priority ?? -1] ?? null,
    estimateH: issue.estimation !== undefined && issue.estimation > 0 ? issue.estimation : null,
    component: issue.component == null ? null : (componentById.get(issue.component) ?? null),
    done: statusById.has(issue.status) ? statusById.get(issue.status)!.category === WON : null,
  }))
}
