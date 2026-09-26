import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionView } from '../state.js'
import { lampOf, sessionsByTask, type AgentEntry } from './agents.js'
import type { ClaudeCli } from './claude.js'
import { projectDirName } from './paths.js'
import { TranscriptFold } from './transcript.js'

export interface SessionMonitorOptions {
  cli: ClaudeCli
  projectsDir: string
  projectKeys: () => string[]
  intervalMs: number
  onChange: (views: SessionView[]) => void
  onError: (error: unknown) => void
}

interface Tracked {
  agent: AgentEntry
  present: boolean
  transcript: TranscriptTail
}

export class SessionMonitor {
  private readonly tracked = new Map<string, Tracked>()
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
    return [...this.tracked].map(([task, tracked]) => toView(task, tracked))
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
      const byTask = sessionsByTask(await this.options.cli.agents(), this.options.projectKeys())
      for (const [task, agent] of byTask) {
        const known = this.tracked.get(task)
        if (known === undefined || known.agent.sessionId !== agent.sessionId) {
          this.tracked.set(task, { agent, present: true, transcript: new TranscriptTail(this.options.projectsDir, agent) })
        } else {
          known.agent = agent
          known.present = true
        }
      }
      for (const [task, tracked] of this.tracked) if (!byTask.has(task)) tracked.present = false

      await Promise.all([...this.tracked.values()].map((tracked) => tracked.transcript.read()))

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

function toView(task: string, { agent, present, transcript }: Tracked): SessionView {
  const summary = transcript.fold.summary()
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
    remoteUrl: summary.remoteUrl,
  }
}

const NEWLINE = 0x0a

class TranscriptTail {
  fold = new TranscriptFold()
  private file: string | undefined
  private offset = 0
  private carry = Buffer.alloc(0)

  constructor(
    private readonly projectsDir: string,
    private readonly agent: AgentEntry,
  ) {}

  async read(): Promise<void> {
    this.file ??= await this.locate()
    if (this.file === undefined) return

    const { size } = await stat(this.file)
    if (size < this.offset) {
      this.fold = new TranscriptFold()
      this.offset = 0
      this.carry = Buffer.alloc(0)
    }
    if (size === this.offset) return

    const handle = await open(this.file, 'r')
    try {
      const chunk = Buffer.alloc(size - this.offset)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset)
      this.offset += bytesRead
      const data = Buffer.concat([this.carry, chunk.subarray(0, bytesRead)])
      const end = data.lastIndexOf(NEWLINE)
      this.carry = Buffer.from(data.subarray(end + 1))
      if (end < 0) return
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) this.fold.push(line)
    } finally {
      await handle.close()
    }
  }

  private async locate(): Promise<string | undefined> {
    const name = `${this.agent.sessionId}.jsonl`
    const expected = join(this.projectsDir, projectDirName(this.agent.cwd), name)
    if (await exists(expected)) return expected
    for (const dir of await readdir(this.projectsDir).catch(() => [])) {
      const candidate = join(this.projectsDir, dir, name)
      if (await exists(candidate)) return candidate
    }
    return undefined
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}
