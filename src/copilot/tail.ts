import { stat } from 'node:fs/promises'
import type { SessionTail } from '../agent/contract.js'
import type { AgentEntry } from '../sessions/agents.js'
import { lineSlices } from '../sessions/lines.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import { eventsFile } from './home.js'
import { CopilotFold } from './transcript.js'
import { withTurnError, type TurnError } from './errors.js'

/** A Copilot session's `events.jsonl` read as it grows; a resume appends to the same file. */
export class CopilotTail implements SessionTail {
  private fold = new CopilotFold()
  private offset = 0
  private error: TurnError | undefined
  /** The summary from before a read in progress, as in `TranscriptTail`. */
  private held: TranscriptSummary | undefined

  constructor(
    private readonly home: string,
    private agent: AgentEntry,
    private readonly errorOf: (sessionId: string) => Promise<TurnError | undefined>,
  ) {}

  get path(): string | undefined {
    return eventsFile(this.home, this.agent.sessionId)
  }

  summary(): TranscriptSummary {
    return withTurnError(this.held ?? this.fold.summary(), this.error)
  }

  follow(agent: AgentEntry): void {
    if (agent.sessionId !== this.agent.sessionId) {
      this.fold = new CopilotFold()
      this.offset = 0
      this.error = undefined
    }
    this.agent = agent
  }

  async read(): Promise<void> {
    this.error = await this.errorOf(this.agent.sessionId)
    const file = eventsFile(this.home, this.agent.sessionId)
    const size = await stat(file).then(
      (info) => info.size,
      () => undefined,
    )
    if (size === undefined || size === this.offset) return
    this.held = this.fold.summary()
    try {
      if (size < this.offset) {
        this.fold = new CopilotFold()
        this.offset = 0
      }
      for await (const { lines, next } of lineSlices(file, this.offset, size)) {
        for (const line of lines) this.fold.push(line)
        this.offset = next
      }
    } finally {
      this.held = undefined
    }
  }
}
