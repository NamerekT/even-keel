import type { AccountHome } from '../account/homes.js'
import { GLOBAL_ACCOUNT } from '../account/model.js'
import type { Agent, SessionTail } from '../agent/contract.js'
import { warmCacheMs, type HandoffSession, type LimitedSession } from '../chain/relay.js'
import type { SessionView } from '../state.js'
import { lampOf, sessionsByTask, type AgentEntry } from './agents.js'
import { remoteLink } from './remote.js'

export interface SessionMonitorOptions {
  /** The agent of an account folder, by `AccountHome.agent`. */
  agentOf: (home: AccountHome) => Pick<Agent, 'sessions' | 'tail' | 'remote'>
  homes: () => AccountHome[]
  emailOf: (account: string) => string | null
  /** An API account's session has no Remote Control and no usage window: it waits out only a key out of credit (`docs/accounts.md`). */
  apiKey: (account: string) => boolean
  projectKeys: () => string[]
  intervalMs: number
  onAgents: (agents: AgentEntry[]) => void
  onChange: (views: SessionView[]) => void
  onError: (error: unknown) => void
}

interface Tracked {
  agent: AgentEntry
  /** The agent the session runs on: its account's. */
  runsOn: string
  present: boolean
  transcript: SessionTail
  bridge: string | null
}

export class SessionMonitor {
  private readonly tracked = new Map<string, Tracked>()
  private readonly tails = new Map<string, SessionTail>()
  /** By account; `null` when its agent has no Remote Control. */
  private readonly remoteEnabled = new Map<string, boolean | null>()
  private lastSnapshot = ''
  private timer: NodeJS.Timeout | undefined
  private running: Promise<void> | undefined
  private stopped = true

  constructor(private readonly options: SessionMonitorOptions) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timer)
    await this.running
  }

  views(): SessionView[] {
    const now = Date.now()
    return [...this.tracked].map(([task, tracked]) => {
      const account = tracked.agent.account ?? GLOBAL_ACCOUNT
      const enabled = this.remoteEnabled.has(account) ? this.remoteEnabled.get(account)! : false
      const remote = { enabled, apiKey: this.options.apiKey(account) }
      return toView(task, tracked, remote, this.options.emailOf(account), now)
    })
  }

  handoff(task: string): HandoffSession | undefined {
    const tracked = this.tracked.get(task)
    if (tracked === undefined) return undefined
    const { agent, transcript } = tracked
    const summary = transcript.summary()
    return {
      sessionId: agent.sessionId,
      agentId: agent.id ?? agent.sessionId,
      account: agent.account ?? GLOBAL_ACCOUNT,
      cwd: agent.cwd,
      workdir: summary.workdir ?? agent.cwd,
      branch: summary.gitBranch,
      transcript: transcript.path ?? null,
      lastReplyAt: summary.lastReplyAt,
      recent: summary.feed,
      lastMessage: summary.lastMessage,
      checkpoint: summary.checkpoint,
    }
  }

  limited(task: string): LimitedSession | undefined {
    const tracked = this.tracked.get(task)
    const session = this.handoff(task)
    if (tracked === undefined || session === undefined || !tracked.present) return undefined
    const apiKey = this.options.apiKey(tracked.agent.account ?? GLOBAL_ACCOUNT)
    const { apiError, cache } = tracked.transcript.summary()
    if (apiError?.kind !== (apiKey ? 'credit' : 'limit') || lampOf(tracked.agent, apiError.kind) !== 'limit') return undefined
    const limited = { ...session, limit: { at: apiError.at, text: apiError.text } }
    return apiKey ? { ...limited, warmMs: warmCacheMs(cache?.ttl ?? null) } : limited
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        if (!this.stopped) this.schedule(this.options.intervalMs)
      })
    }, delay)
  }

  private async tick(): Promise<void> {
    try {
      const homes = this.options.homes()
      const homeOf = new Map(homes.map((home) => [home.key, home]))
      const agents = (await Promise.all(homes.map((home) => this.agentsOf(home)))).flat()
      this.options.onAgents(agents)
      for (const agent of agents) {
        const tail = this.tails.get(agent.sessionId)
        const home = homeOf.get(agent.account ?? GLOBAL_ACCOUNT)!
        if (tail === undefined) this.tails.set(agent.sessionId, this.options.agentOf(home).tail(home, agent))
        else tail.follow(agent)
      }
      const tracked = new Set([...this.tracked.values()].map(({ agent }) => agent.sessionId))
      const live = new Set(agents.map((agent) => agent.sessionId))
      for (const id of this.tails.keys()) if (!live.has(id) && !tracked.has(id)) this.tails.delete(id)
      const reads = await Promise.allSettled([...this.tails.values()].map((tail) => tail.read()))
      for (const read of reads) if (read.status === 'rejected') this.options.onError(read.reason)

      for (const home of homes) {
        const remote = this.options.agentOf(home).remote
        this.remoteEnabled.set(home.key, remote === undefined ? null : await remote.enabled(home))
      }
      const branchOf = (agent: AgentEntry) => this.tails.get(agent.sessionId)?.summary().gitBranch ?? null
      const byTask = sessionsByTask(agents, this.options.projectKeys(), branchOf)
      for (const [task, agent] of byTask) {
        const home = homeOf.get(agent.account ?? GLOBAL_ACCOUNT)!
        const live = (await this.options.agentOf(home).remote?.bridge(home, agent)) ?? null
        const bridge = live ?? this.tracked.get(task)?.bridge ?? null
        this.tracked.set(task, { agent, runsOn: home.agent, present: true, transcript: this.tails.get(agent.sessionId)!, bridge })
      }
      for (const [task, known] of this.tracked) if (!byTask.has(task)) known.present = false

      const views = this.views()
      const snapshot = JSON.stringify(views)
      if (snapshot !== this.lastSnapshot) {
        this.lastSnapshot = snapshot
        this.options.onChange(views)
      }
    } catch (error) {
      this.options.onError(error)
    }
  }

  private async agentsOf(home: AccountHome): Promise<AgentEntry[]> {
    try {
      return await this.options.agentOf(home).sessions(home)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${home.agent} sessions in ${home.key}: ${message}`, { cause: error })
    }
  }
}

function toView(
  task: string,
  { agent, runsOn, present, transcript, bridge }: Tracked,
  remoteOf: { enabled: boolean | null; apiKey: boolean },
  email: string | null,
  now: number,
): SessionView {
  const summary = transcript.summary()
  const remote = remoteLink({
    bridge,
    transcriptUrl: summary.remoteUrl,
    lost: summary.remoteLost,
    ...remoteOf,
    startedAt: agent.startedAt,
    now,
  })
  const ask = present ? (summary.ask ?? agent.ask ?? null) : null
  return {
    task,
    sessionId: agent.sessionId,
    agent: runsOn,
    cwd: agent.cwd,
    branch: summary.gitBranch,
    lamp: lampOf(present ? agent : undefined, summary.apiError?.kind ?? null, now),
    checkpoint: summary.checkpoint !== null,
    waitingFor: present && agent.status === 'waiting' ? (agent.waitingFor ?? null) : null,
    startupDialog: present ? (agent.startupDialog ?? null) : null,
    asking: ask !== null,
    ask,
    apiError: summary.apiError?.text ?? null,
    startedAt: new Date(agent.startedAt).toISOString(),
    lastActivityAt: summary.lastActivityAt,
    contextTokens: summary.contextTokens,
    cache: summary.cache,
    tokens: summary.tokens,
    stage: summary.stage,
    action: summary.action,
    feed: summary.feed,
    remoteUrl: remote.url,
    remoteOff: remote.off,
    account: email,
  }
}
