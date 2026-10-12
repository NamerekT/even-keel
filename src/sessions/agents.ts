import { questionsOf, type Ask } from './ask.js'
import type { ApiErrorKind } from './transcript.js'

/** `shell` — the turn has ended, but a background command the session started still runs. */
export type AgentStatus = 'idle' | 'busy' | 'shell' | 'waiting'
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
  /** What the dialog the session hangs on before its first turn asks for. */
  startupDialog?: string
  /** The `AskUserQuestion` the waiting session has open, by its job file. */
  ask?: Ask
}

/**
 * What a blocked job waits for, from `jobs/<id>/state.json`: the CLI writes `needs` for a dialog it knows
 * (an unapproved MCP server) and "stuck on a startup dialog" when its 45 s watchdog sees no first turn.
 */
export function blockedOn(raw: string | undefined): string | null {
  const job = blockedJob(raw)
  if (job === null) return null
  const { detail, needs } = job
  if (typeof needs === 'string' && needs !== '') return needs
  return typeof detail === 'string' && detail !== '' ? detail : null
}

/**
 * The `AskUserQuestion` a blocked job waits on, from `block.questions` of its `jobs/<id>/state.json`: the question
 * and the options, without `header`, `multiSelect` or `preview`. The CLI (2.1.296) writes the message with a pending
 * call into the transcript only once it is answered, so until then the question is nowhere else.
 */
export function blockedAsk(raw: string | undefined, jobId: string): Ask | null {
  const questions = questionsOf(blockedJob(raw)?.block)
  if (questions.length === 0) return null
  return { id: `job:${jobId}:${fnv1a(JSON.stringify(questions))}`, questions, unsaved: true }
}

/** The page's type check reads this file too, so no `node:crypto` here. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function blockedJob(raw: string | undefined): Record<string, unknown> | null {
  if (raw === undefined) return null
  try {
    const job: unknown = JSON.parse(raw)
    if (typeof job !== 'object' || job === null) return null
    return (job as Record<string, unknown>).tempo === 'blocked' ? (job as Record<string, unknown>) : null
  } catch {
    return null
  }
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
  entrypoint?: string
  name?: string
  cwd?: string
}

const STATUSES: readonly string[] = ['idle', 'busy', 'shell', 'waiting'] satisfies AgentStatus[]

export function parseSessionRecord(raw: string): SessionRecord | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const { pid, sessionId, status, waitingFor, entrypoint, name, cwd } = value as Record<string, unknown>
  if (typeof pid !== 'number' || typeof sessionId !== 'string') return undefined
  return {
    pid,
    sessionId,
    ...(typeof status === 'string' && STATUSES.includes(status) ? { status: status as AgentStatus } : {}),
    ...(typeof waitingFor === 'string' ? { waitingFor } : {}),
    ...(typeof entrypoint === 'string' ? { entrypoint } : {}),
    ...(typeof name === 'string' && name !== '' ? { name } : {}),
    ...(typeof cwd === 'string' ? { cwd } : {}),
  }
}

export function withLiveRecords(agents: AgentEntry[], records: SessionRecord[]): AgentEntry[] {
  const bySession = new Map(records.map((record) => [record.sessionId, record]))
  return agents.map((agent) => {
    const record = bySession.get(agent.sessionId)
    if (record === undefined) return agent
    if (agent.pid !== undefined) return record.status === 'shell' ? { ...agent, status: 'shell' } : agent
    const { pid, status, waitingFor } = record
    return { ...agent, pid, ...(status === undefined ? {} : { status }), ...(waitingFor === undefined ? {} : { waitingFor }) }
  })
}

const SHELL_HANG_MS = 60 * 60_000

/**
 * The status the chain goes by. A session in `shell` waits for its own background command (a long build or test run)
 * and counts as busy; after an hour without a line in its transcript the command is taken for hung and the session for idle.
 * A turn that ended on a limit has nothing to continue with when the command ends, so such a session is idle at once.
 */
export function turnStatus(
  status: AgentStatus | undefined,
  lastActivityAt: string | null,
  now: Date,
  limit = false,
): AgentStatus | undefined {
  if (status !== 'shell') return status
  if (limit) return 'idle'
  if (lastActivityAt === null) return 'busy'
  return now.getTime() - Date.parse(lastActivityAt) >= SHELL_HANG_MS ? 'idle' : 'busy'
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
    if (task === undefined || !keys.has(task.replace(/-(\d+|FIX)$/, ''))) continue
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
  return /^[A-Z][A-Z0-9_]*-(\d+|FIX)$/.exec(name ?? '')?.[0]
}

function taskOfBranch(branch: string | null): string | undefined {
  return /^[a-z][a-z0-9_]*-(\d+|fix)(?=\/|$)/.exec(branch ?? '')?.[0].toUpperCase()
}

/** How long a fresh background job may go without a live process before its `state` stops being trusted. */
const LAUNCH_GRACE_MS = 5 * 60_000

/**
 * `claude agents` keeps `state: working` for a job whose process died long ago: past its launch, a job with no live
 * `sessions/<pid>.json` (no `pid`) is finished unless it hangs on a startup dialog.
 */
export function lampOf(agent: AgentEntry | undefined, apiError: ApiErrorKind | null, now = Date.now()): Lamp {
  if (agent === undefined || agent.state === 'done' || agent.state === 'stopped') return 'finished'
  if (agent.state === 'failed') return 'error'
  if (agent.pid === undefined && agent.state !== 'blocked' && now - agent.startedAt > LAUNCH_GRACE_MS) return 'finished'
  if (agent.status === 'busy' || (agent.status === 'shell' && apiError !== 'limit')) return 'working'
  if (apiError !== null) return apiError
  if (agent.status === 'waiting' || agent.state === 'blocked') return 'waiting'
  if (agent.status === 'idle') return 'waiting'
  return 'working'
}
