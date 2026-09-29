import type { ApiErrorKind } from './transcript.js'

export type AgentStatus = 'idle' | 'busy' | 'waiting'
export type AgentState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped'
export type Lamp = 'working' | 'waiting' | 'error' | 'limit' | 'finished'

export interface AgentEntry {
  id?: string
  pid?: number
  cwd: string
  kind: string
  startedAt: number
  sessionId: string
  name?: string
  status?: AgentStatus
  waitingFor?: string
  state?: AgentState
  account?: string
}

export function parseAgents(raw: string, account?: string): AgentEntry[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error('agents: claude agents --json did not print a list')
  const entries = value.filter(isAgentEntry)
  return account === undefined ? entries : entries.map((entry) => ({ ...entry, account }))
}

export interface SessionRecord {
  pid: number
  sessionId: string
  status?: AgentStatus
  waitingFor?: string
}

const STATUSES: readonly string[] = ['idle', 'busy', 'waiting'] satisfies AgentStatus[]

export function parseSessionRecord(raw: string): SessionRecord | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const { pid, sessionId, status, waitingFor } = value as Record<string, unknown>
  if (typeof pid !== 'number' || typeof sessionId !== 'string') return undefined
  return {
    pid,
    sessionId,
    ...(typeof status === 'string' && STATUSES.includes(status) ? { status: status as AgentStatus } : {}),
    ...(typeof waitingFor === 'string' ? { waitingFor } : {}),
  }
}

export function withLiveRecords(agents: AgentEntry[], records: SessionRecord[]): AgentEntry[] {
  const bySession = new Map(records.map((record) => [record.sessionId, record]))
  return agents.map((agent) => {
    const record = bySession.get(agent.sessionId)
    if (record === undefined || agent.pid !== undefined) return agent
    const { pid, status, waitingFor } = record
    return { ...agent, pid, ...(status === undefined ? {} : { status }), ...(waitingFor === undefined ? {} : { waitingFor }) }
  })
}

function isAgentEntry(value: unknown): value is AgentEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.sessionId === 'string' &&
    typeof entry.cwd === 'string' &&
    typeof entry.kind === 'string' &&
    typeof entry.startedAt === 'number'
  )
}

export function sessionsByTask(
  agents: AgentEntry[],
  projectKeys: string[],
  branchOf: (agent: AgentEntry) => string | null = () => null,
): Map<string, AgentEntry> {
  const keys = new Set(projectKeys)
  const byTask = new Map<string, Candidate>()
  for (const agent of agents) {
    const named = taskOfName(agent.name)
    const task = named ?? taskOfBranch(branchOf(agent))
    if (task === undefined || !keys.has(task.replace(/-\d+$/, ''))) continue
    const candidate = { agent, named: named !== undefined }
    const known = byTask.get(task)
    if (known === undefined || outranks(candidate, known)) byTask.set(task, candidate)
  }
  return new Map(
    [...byTask]
      .map(([task, { agent }]) => [task, agent] as const)
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
  )
}

interface Candidate {
  agent: AgentEntry
  named: boolean
}

function outranks(candidate: Candidate, known: Candidate): boolean {
  if (candidate.named !== known.named) return candidate.named
  return candidate.agent.startedAt > known.agent.startedAt
}

function taskOfName(name: string | undefined): string | undefined {
  return /^[A-Z][A-Z0-9_]*-\d+$/.exec(name ?? '')?.[0]
}

function taskOfBranch(branch: string | null): string | undefined {
  return /^[a-z][a-z0-9_]*-\d+(?=\/|$)/.exec(branch ?? '')?.[0].toUpperCase()
}

export function lampOf(agent: AgentEntry | undefined, apiError: ApiErrorKind | null): Lamp {
  if (agent === undefined || agent.state === 'done' || agent.state === 'stopped') return 'finished'
  if (agent.state === 'failed') return 'error'
  if (agent.status === 'busy') return 'working'
  if (apiError !== null) return apiError
  if (agent.status === 'waiting' || agent.state === 'blocked') return 'waiting'
  if (agent.status === 'idle') return 'waiting'
  return 'working'
}
