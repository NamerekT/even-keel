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
}

export function parseAgents(raw: string): AgentEntry[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error('agents: claude agents --json did not print a list')
  return value.filter(isAgentEntry)
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

export function sessionsByTask(agents: AgentEntry[], projectKeys: string[]): Map<string, AgentEntry> {
  const keys = new Set(projectKeys)
  const byTask = new Map<string, AgentEntry>()
  for (const agent of agents) {
    const match = /^([A-Z][A-Z0-9_]*)-\d+$/.exec(agent.name ?? '')
    if (match === null || !keys.has(match[1] ?? '')) continue
    const known = byTask.get(match[0])
    if (known === undefined || agent.startedAt > known.startedAt) byTask.set(match[0], agent)
  }
  return new Map([...byTask].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })))
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
