import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionView } from '../state.js'
import { lampOf, sessionsByTask, type AgentEntry } from './agents.js'
import type { ClaudeCli } from './claude.js'
import { bridgeOfRecord, remoteAtStartup, remoteLink } from './remote.js'
import { TranscriptTail } from './tail.js'

export interface SessionMonitorOptions {
  cli: ClaudeCli
  claudeDir: string
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
  private remoteEnabled = false
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
    return [...this.tracked].map(([task, tracked]) => toView(task, tracked, this.remoteEnabled, now))
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
      const { claudeDir } = this.options
      const agents = await this.options.cli.agents()
      this.options.onAgents(agents)
      for (const agent of agents) {
        const tail = this.tails.get(agent.sessionId)
        if (tail === undefined) this.tails.set(agent.sessionId, new TranscriptTail(join(claudeDir, 'projects'), agent))
        else tail.follow(agent)
      }
      const tracked = new Set([...this.tracked.values()].map(({ agent }) => agent.sessionId))
      const live = new Set(agents.map((agent) => agent.sessionId))
      for (const id of this.tails.keys()) if (!live.has(id) && !tracked.has(id)) this.tails.delete(id)
      const reads = await Promise.allSettled([...this.tails.values()].map((tail) => tail.read()))
      for (const read of reads) if (read.status === 'rejected') this.options.onError(read.reason)

      this.remoteEnabled = remoteAtStartup(await readText(join(claudeDir, 'settings.json')))
      const branchOf = (agent: AgentEntry) => this.tails.get(agent.sessionId)?.fold.summary().gitBranch ?? null
      const byTask = sessionsByTask(agents, this.options.projectKeys(), branchOf)
      for (const [task, agent] of byTask) {
        const record = agent.pid === undefined ? undefined : await readText(join(claudeDir, 'sessions', `${agent.pid}.json`))
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
}

function toView(task: string, { agent, present, transcript, bridge }: Tracked, remoteEnabled: boolean, now: number): SessionView {
  const summary = transcript.fold.summary()
  const remote = remoteLink({
    bridge,
    transcriptUrl: summary.remoteUrl,
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
    apiError: summary.apiError?.text ?? null,
    startedAt: new Date(agent.startedAt).toISOString(),
    lastActivityAt: summary.lastActivityAt,
    contextTokens: summary.contextTokens,
    tokens: summary.tokens,
    stage: summary.stage,
    action: summary.action,
    feed: summary.feed,
    remoteUrl: remote.url,
    remoteOff: remote.off,
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}
