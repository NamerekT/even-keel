import type { AccountHome } from '../account/homes.js'
import { GLOBAL_ACCOUNT } from '../account/model.js'
import type { Agent, SessionTail } from '../agent/contract.js'
import type { HandoffSession, LimitedSession } from '../chain/relay.js'
import type { SessionView } from '../state.js'
import { SESSION_WINDOWS_KEPT } from '../storage/context-windows.js'
import { backgroundWait, isLive, lampOf, sessionsByTask, steadyJobs, type AgentEntry, type JobIds } from './agents.js'
import type { Ask } from './ask.js'
import { WARM_CACHE_MS } from './cache.js'
import { ResumeHolds } from './holds.js'
import { remoteLink } from './remote.js'
import { TurnActivity } from './activity.js'
import { rareEvents } from './rare.js'

export interface SessionMonitorOptions {
  /** The agent of an account folder, by `AccountHome.agent`. */
  agentOf: (home: AccountHome) => Pick<Agent, 'sessions' | 'tail' | 'remote' | 'warmMs'>
  homes: () => AccountHome[]
  emailOf: (account: string) => string | null
  /** An API account waits out spent credit and spending caps, with no subscription usage window (`docs/accounts.md`). */
  apiKey: (account: string) => boolean
  /** Optional. A key account with a usage window (Copilot's token, BTN-341): it waits out a spent quota as well as spent credit. */
  keyLimits?: (account: string) => boolean
  projectKeys: () => string[]
  /** Optional. The window the agent itself gives for a task's session of the account on the model; `null` — not known yet. */
  contextWindow?: (account: string, model: string, task: string, settings?: string) => number | null
  /** Optional. The sessions' windows kept before this start, oldest first (BTN-946). */
  sessionWindows?: [string, number][]
  /** Optional. The windows seen for the first time or changed in one poll, a session once, to keep through a restart. */
  onSessionWindows?: (windows: [string, number][]) => void
  /** Optional. The tool call a waiting session's permission hook holds, as a question (BTN-269). */
  approval?: (sessionId: string) => Ask | null
  intervalMs: number
  onAgents: (agents: AgentEntry[]) => void
  onChange: (views: SessionView[]) => void
  onError: (error: unknown) => void
}

interface Tracked {
  agent: AgentEntry
  /** The agent the session runs on: its account's. */
  runsOn: string
  /** Its agent's `warmMs`. */
  warmMs: Agent['warmMs']
  present: boolean
  transcript: SessionTail
  bridge: string | null
}

export class SessionMonitor {
  private readonly tracked = new Map<string, Tracked>()
  private readonly tails = new Map<string, SessionTail>()
  private readonly jobIds: JobIds = new Map()
  private readonly activity = new TurnActivity()
  /** The sessions the chain is resuming: shown working, not finished, while the daemon respawns them. */
  readonly holds = new ResumeHolds()
  /** By account; `null` when its agent has no Remote Control. */
  private readonly remoteEnabled = new Map<string, boolean | null>()
  /** The compactions seen in each transcript followed since the start, kept after its session leaves the agents' list. */
  private readonly compactions = new Map<string, number>()
  /** Last non-null windows in first-observed order: of every session shown and up to `SESSION_WINDOWS_KEPT` in all; kept through a restart (`session_windows`). */
  private readonly contextWindows: Map<string, number>
  private lastSnapshot = ''
  private timer: NodeJS.Timeout | undefined
  private running: Promise<void> | undefined
  private stopped = true

  constructor(private readonly options: SessionMonitorOptions) {
    this.contextWindows = new Map(options.sessionWindows)
  }

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
      const windowOf = (model: string) => this.options.contextWindow?.(account, model, task, tracked.agent.settings) ?? null
      const approval = tracked.present && tracked.agent.status === 'waiting' ? (this.options.approval?.(tracked.agent.sessionId) ?? null) : null
      const view = toView(task, tracked, remote, this.options.emailOf(account), now, windowOf, approval)
      return view.lamp === 'finished' && this.holds.held(view.sessionId) ? { ...view, lamp: 'working' as const } : view
    })
  }

  /** The context of a live session as of the last poll; `undefined` — its transcript is not followed. */
  contextOf(sessionId: string): number | undefined {
    return this.tails.get(sessionId)?.summary().contextTokens
  }

  contextWindowOf(sessionId: string): number | null {
    return this.contextWindows.get(sessionId) ?? null
  }

  compactionsOf(sessionId: string): number {
    return this.compactions.get(sessionId) ?? 0
  }

  /** Where Even Keel set the session to compact (`AgentEntry.compactAt`); `null` — the agent's own point. */
  compactAtOf(sessionId: string): number | null {
    for (const { agent } of this.tracked.values()) if (agent.sessionId === sessionId) return agent.compactAt ?? null
    return null
  }

  handoff(task: string): HandoffSession | undefined {
    const tracked = this.tracked.get(task)
    if (tracked === undefined) return undefined
    const { agent, transcript } = tracked
    const summary = transcript.summary()
    const account = agent.account ?? GLOBAL_ACCOUNT
    return {
      sessionId: agent.sessionId,
      agentId: agent.id ?? agent.sessionId,
      account,
      cwd: agent.cwd,
      workdir: summary.workdir ?? agent.cwd,
      branch: summary.gitBranch,
      transcript: transcript.path ?? null,
      lastReplyAt: summary.lastReplyAt,
      recent: summary.feed,
      lastMessage: summary.lastMessage,
      checkpoint: summary.checkpoint,
      pullRequest: summary.pullRequest,
      noChanges: summary.noChanges,
      warmMs: tracked.warmMs?.(summary.cache, this.options.apiKey(account)) ?? WARM_CACHE_MS,
    }
  }

  limited(task: string): LimitedSession | undefined {
    const tracked = this.tracked.get(task)
    const session = this.handoff(task)
    if (tracked === undefined || session === undefined || !tracked.present) return undefined
    const account = tracked.agent.account ?? GLOBAL_ACCOUNT
    const apiKey = this.options.apiKey(account)
    const waited = apiKey ? (this.options.keyLimits?.(account) === true ? ['credit', 'spend', 'limit'] : ['credit', 'spend']) : ['limit']
    const { apiError } = tracked.transcript.summary()
    if (apiError?.kind === 'transient' && !this.holds.held(session.sessionId) && lampOf(tracked.agent, apiError.kind) === 'waiting') {
      return { ...session, transient: true, limit: { at: apiError.at, text: apiError.text } }
    }
    if (apiError === null || !waited.includes(apiError.kind) || lampOf(tracked.agent, apiError.kind) !== 'limit') return undefined
    return { ...session, limit: { at: apiError.at, text: apiError.text, ...(apiError.kind === 'credit' ? { credit: true as const } : {}) } }
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
      const agents = steadyJobs((await Promise.all(homes.map((home) => this.agentsOf(home)))).flat(), this.jobIds)
      this.holds.sweep(
        (sessionId) => agents.some((agent) => agent.sessionId === sessionId && isLive(agent)),
        (sessionId) => agents.some((agent) => agent.sessionId === sessionId && isLive(agent) && agent.status === 'busy'),
      )
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
      this.activity.sweep(live)
      const dated = await Promise.all(agents.map((agent) => this.activity.read(agent, this.tails.get(agent.sessionId)!, Date.now())))
      this.options.onAgents(dated)
      for (const [id, tail] of this.tails) {
        const compactions = tail.summary().compactions
        if (compactions > 0) this.compactions.set(id, compactions)
      }

      for (const home of homes) {
        const remote = this.options.agentOf(home).remote
        this.remoteEnabled.set(home.key, remote === undefined ? null : await remote.enabled(home))
      }
      const branchOf = (agent: AgentEntry) => this.tails.get(agent.sessionId)?.summary().gitBranch ?? null
      const byTask = sessionsByTask(dated, this.options.projectKeys(), branchOf)
      for (const [task, agent] of byTask) {
        const home = homeOf.get(agent.account ?? GLOBAL_ACCOUNT)!
        const { remote, warmMs } = this.options.agentOf(home)
        const live = (await remote?.bridge(home, agent)) ?? null
        const bridge = live ?? this.tracked.get(task)?.bridge ?? null
        this.tracked.set(task, { agent, runsOn: home.agent, warmMs, present: true, transcript: this.tails.get(agent.sessionId)!, bridge })
      }
      for (const [task, known] of this.tracked) if (!byTask.has(task)) known.present = false

      const views = this.views()
      const changed = new Map<string, number>()
      for (const view of views) {
        if (byTask.has(view.task) && view.contextWindow !== null && this.contextWindows.get(view.sessionId) !== view.contextWindow) {
          this.contextWindows.set(view.sessionId, view.contextWindow)
          changed.set(view.sessionId, view.contextWindow)
        }
        rareEvents.observe(view, this.tails.get(view.sessionId)?.path !== undefined)
        const agent = byTask.get(view.task)
        if (view.lamp === 'waiting' && agent?.backgroundBlock !== undefined) {
          rareEvents.once('46', agent.backgroundBlock.event, view,
            `background-blocked detail=${JSON.stringify(agent.backgroundBlock.detail)}; treating the session as waiting`)
        }
      }
      if (changed.size > 0) {
        this.options.onSessionWindows?.([...changed])
        this.forgetWindows(new Set(views.map((view) => view.sessionId)))
      }
      const snapshot = JSON.stringify([views, [...this.compactions]])
      if (snapshot !== this.lastSnapshot) {
        this.lastSnapshot = snapshot
        this.options.onChange(views)
      }
    } catch (error) {
      this.options.onError(error)
    }
  }

  /** Drops the oldest windows past the limit; a session the page still shows keeps its own, or it would be written again every poll (BTN-951). */
  private forgetWindows(shown: Set<string>): void {
    for (const id of this.contextWindows.keys()) {
      if (this.contextWindows.size <= SESSION_WINDOWS_KEPT) return
      if (!shown.has(id)) this.contextWindows.delete(id)
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
  windowOf: (model: string) => number | null,
  approval: Ask | null,
): SessionView {
  const summary = transcript.summary()
  const model = agent.model ?? summary.model
  const remote = remoteLink({
    bridge,
    transcriptUrl: summary.remoteUrl,
    lost: summary.remoteLost,
    ...remoteOf,
    startedAt: agent.startedAt,
    now,
  })
  const ask = present ? (approval ?? summary.ask ?? agent.ask ?? null) : null
  const lamp = lampOf(present ? agent : undefined, summary.apiError?.kind ?? null, now)
  return {
    task,
    sessionId: agent.sessionId,
    agent: runsOn,
    model: summary.model,
    cwd: agent.cwd,
    branch: summary.gitBranch,
    lamp,
    background: backgroundWait(present ? agent : undefined, lamp, summary.lastActivityAt, summary.backgroundCommand ?? null),
    checkpoint: summary.checkpoint !== null,
    waitingFor: present && agent.status === 'waiting' ? (agent.waitingFor ?? null) : null,
    startupDialog: present ? (agent.startupDialog ?? null) : null,
    hungSince: present && agent.hungSince !== undefined ? new Date(agent.hungSince).toISOString() : null,
    silentSince: present && agent.silentSince !== undefined ? new Date(agent.silentSince).toISOString() : null,
    asking: ask !== null,
    ask,
    apiError: summary.apiError?.text ?? null,
    apiErrorKind: summary.apiError?.kind ?? null,
    ...(summary.apiError?.notice === undefined ? {} : { apiErrorNotice: summary.apiError.notice }),
    startedAt: new Date(agent.startedAt).toISOString(),
    lastActivityAt: summary.lastActivityAt,
    contextTokens: summary.contextTokens,
    contextWindow: summary.contextWindow ?? agent.contextWindow ?? (model === null ? null : windowOf(model)),
    cache: summary.cache,
    tokens: summary.tokens,
    stage: summary.stage,
    action: summary.action,
    feed: summary.feed,
    ...(summary.badgeStatus === undefined ? {} : { badgeStatus: summary.badgeStatus }),
    remoteUrl: remote.url,
    remoteOff: remote.off,
    account: email,
  }
}
