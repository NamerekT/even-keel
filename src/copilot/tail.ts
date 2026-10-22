import { stat } from 'node:fs/promises'
import type { SessionTail } from '../agent/contract.js'
import type { AgentEntry } from '../sessions/agents.js'
import { readLines } from '../sessions/lines.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import { eventsFile } from './home.js'
import { CopilotFold } from './transcript.js'

/** A Copilot session's `events.jsonl` read as it grows; a resume appends to the same file. */
export class CopilotTail implements SessionTail {
  private fold = new CopilotFold()
  private offset = 0

  constructor(
    private readonly home: string,
    private agent: AgentEntry,
  ) {}

  get path(): string | undefined {
    return eventsFile(this.home, this.agent.sessionId)
  }

  summary(): TranscriptSummary {
    return this.fold.summary()
  }

  follow(agent: AgentEntry): void {
    if (agent.sessionId !== this.agent.sessionId) {
      this.fold = new CopilotFold()
      this.offset = 0
    }
    this.agent = agent
  }

  async read(): Promise<void> {
    const file = eventsFile(this.home, this.agent.sessionId)
    const size = await stat(file).then(
      (info) => info.size,
      () => undefined,
    )
    if (size === undefined) return
    if (size < this.offset) {
      this.fold = new CopilotFold()
      this.offset = 0
    }
    const { lines, next } = await readLines(file, this.offset, size)
    this.offset = next
    for (const line of lines) this.fold.push(line)
  }
}
