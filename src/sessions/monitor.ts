import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import { GLOBAL_ACCOUNT } from '../account/model.js'
import type { HandoffSession, LimitedSession } from '../chain/relay.js'
import type { SessionView } from '../state.js'
import { lampOf, sessionsByTask, type AgentEntry } from './agents.js'
import type { ClaudeCli } from './claude.js'
import { bridgeOfRecord, remoteAtStartup, remoteLink } from './remote.js'
import { TranscriptTail } from './tail.js'

export interface SessionMonitorOptions {
  cli: ClaudeCli
  homes: () => AccountHome[]
  emailOf: (account: string) => string | null
  projectKeys: () => string[]
  intervalMs: number
  onAgents: (agents: AgentEntry[]) => void
  onChange: (views: SessionView[]) => void
  onError: (error: unknown) => void
}

interface Tracked {
  agent: AgentEntry
  present: boolean
  transcript: TranscriptTail
  bridge: string | null
}

export class SessionMonitor {
  private readonly tracked = new Map<string, Tracked>()
  private readonly tails = new Map<string, TranscriptTail>()
  private readonly remoteEnabled = new Map<string, boolean>()
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
      return toView(task, tracked, this.remoteEnabled.get(account) ?? false, this.options.emailOf(account), now)
    })
  }

  handoff(task: string): HandoffSession | undefined {
    const tracked = this.tracked.get(task)
    if (tracked === undefined) return undefined
    const { agent, transcript } = tracked
    const summary = transcript.fold.summary()
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
    const { apiError } = tracked.transcript.fold.summary()
    if (apiError?.kind !== 'limit' || lampOf(tracked.agent, 'limit') !== 'limit') return undefined
    return { ...session, limit: { at: apiError.at, text: apiError.text } }
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
      const dirOf = new Map(homes.map((home) => [home.key, home.dir]))
      const agents = (await Promise.all(homes.map((home) => this.agentsOf(home)))).flat()
      this.options.onAgents(agents)
      for (const agent of agents) {
        const tail = this.tails.get(agent.sessionId)
        const projects = join(dirOf.get(agent.account ?? GLOBAL_ACCOUNT)!, 'projects')
        if (tail === undefined) this.tails.set(agent.sessionId, new TranscriptTail(projects, agent))
        else tail.follow(agent)
      }
      const tracked = new Set([...this.tracked.values()].map(({ agent }) => agent.sessionId))
      const live = new Set(agents.map((agent) => agent.sessionId))
      for (const id of this.tails.keys()) if (!live.has(id) && !tracked.has(id)) this.tails.delete(id)
      const reads = await Promise.allSettled([...this.tails.values()].map((tail) => tail.read()))
      for (const read of reads) if (read.status === 'rejected') this.options.onError(read.reason)

      for (const home of homes) this.remoteEnabled.set(home.key, remoteAtStartup(await readText(join(home.dir, 'settings.json'))))
      const branchOf = (agent: AgentEntry) => this.tails.get(agent.sessionId)?.fold.summary().gitBranch ?? null
      const byTask = sessionsByTask(agents, this.options.projectKeys(), branchOf)
      for (const [task, agent] of byTask) {
        const dir = dirOf.get(agent.account ?? GLOBAL_ACCOUNT)!
        const record = agent.pid === undefined ? undefined : await readText(join(dir, 'sessions', `${agent.pid}.json`))
        const bridge = bridgeOfRecord(record, agent.sessionId) ?? this.tracked.get(task)?.bridge ?? null
        this.tracked.set(task, { agent, present: true, transcript: this.tails.get(agent.sessionId)!, bridge })
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
      return await this.options.cli.agents(home)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`claude agents in ${home.key}: ${message}`, { cause: error })
    }
  }
}

function toView(
  task: string,
  { agent, present, transcript, bridge }: Tracked,
  remoteEnabled: boolean,
  email: string | null,
  now: number,
): SessionView {
  const summary = transcript.fold.summary()
  const remote = remoteLink({
    bridge,
    transcriptUrl: summary.remoteUrl,
    lost: summary.remoteLost,
    enabled: remoteEnabled,
    startedAt: agent.startedAt,
    now,
  })
  return {
    task,
    sessionId: agent.sessionId,
    cwd: agent.cwd,
    lamp: lampOf(present ? agent : undefined, summary.apiError?.kind ?? null),
    waitingFor: present && agent.status === 'waiting' ? (agent.waitingFor ?? null) : null,
    startupDialog: present && agent.startupDialog === true,
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

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}
