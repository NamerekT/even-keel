import { stat } from 'node:fs/promises'
import type { SessionTail } from '../agent/contract.js'
import type { AgentEntry } from '../sessions/agents.js'
import { readLines } from '../sessions/lines.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import { RolloutFold, rolloutFile } from './rollout.js'

/** A Codex session's rollout read as it grows; a resume appends to the same file. */
export class RolloutTail implements SessionTail {
  private fold = new RolloutFold()
  private file: string | undefined
  private offset = 0

  constructor(
    private readonly home: string,
    private agent: AgentEntry,
  ) {}

  get path(): string | undefined {
    return this.file
  }

  summary(): TranscriptSummary {
    return this.fold.summary()
  }

  follow(agent: AgentEntry): void {
    this.agent = agent
  }

  async read(): Promise<void> {
    this.file ??= await rolloutFile(this.home, this.agent.sessionId)
    if (this.file === undefined) return
    const size = await stat(this.file).then(
      (info) => info.size,
      () => undefined,
    )
    if (size === undefined) {
      this.file = undefined
      return
    }
    if (size < this.offset) {
      this.fold = new RolloutFold()
      this.offset = 0
    }
    const { lines, next } = await readLines(this.file, this.offset, size)
    this.offset = next
    for (const line of lines) this.fold.push(line)
  }
}
