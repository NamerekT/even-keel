import type { SessionTail } from '../agent/contract.js'
import type { AgentEntry } from '../sessions/agents.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import { sessionRows, sessionStamp } from './db.js'
import { foldSession } from './transcript.js'

/**
 * An OpenCode session read as it grows. Its rows change in place (a tool part goes from `running` to `completed`), so
 * there is no offset to read on from: the session is folded anew whenever any of its rows changed since the last read.
 */
export class OpenCodeTail implements SessionTail {
  private folded: TranscriptSummary = foldSession([], [])
  private stamp: number | undefined

  constructor(
    private readonly home: string,
    private agent: AgentEntry,
  ) {}

  /** None: the transcript is rows of the account's database, not a file a handoff could point the next session at. */
  get path(): string | undefined {
    return undefined
  }

  summary(): TranscriptSummary {
    return this.folded
  }

  follow(agent: AgentEntry): void {
    this.agent = agent
  }

  async read(): Promise<void> {
    const stamp = await sessionStamp(this.home, this.agent.sessionId)
    if (stamp === undefined || stamp === this.stamp) return
    const rows = await sessionRows(this.home, this.agent.sessionId)
    if (rows === undefined) return
    this.stamp = rows.stamp
    this.folded = foldSession(rows.messages, rows.parts)
  }
}
