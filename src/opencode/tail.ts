import type { SessionTail } from '../agent/contract.js'
import type { AgentEntry } from '../sessions/agents.js'
import type { TranscriptSummary } from '../sessions/transcript.js'
import type { TurnError } from './cli.js'
import { sessionRows, sessionStamp } from './db.js'
import { foldSession } from './transcript.js'
import { modelTitle, withTitle } from './window.js'

/**
 * An OpenCode session read as it grows. Its rows change in place (a tool part goes from `running` to `completed`), so
 * there is no offset to read on from: the session is folded anew whenever any of its rows changed since the last read.
 */
export class OpenCodeTail implements SessionTail {
  private folded: TranscriptSummary = foldSession([], [])
  private stamp: string | undefined
  private title: { model: string; title: string | null } | undefined

  /** `errors` — those the session's turns ended on: they are not rows of the database, so they change the stamp too. */
  constructor(
    private readonly home: string,
    private agent: AgentEntry,
    private readonly errors: (sessionId: string) => Promise<TurnError[]>,
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
    const [rowStamp, errors] = await Promise.all([sessionStamp(this.home, this.agent.sessionId), this.errors(this.agent.sessionId)])
    if (rowStamp === undefined) return
    const errorStamp = errors.map((error) => error.at).join(',')
    if (`${rowStamp}:${errorStamp}` === this.stamp) return
    const rows = await sessionRows(this.home, this.agent.sessionId)
    if (rows === undefined) return
    this.stamp = `${rows.stamp}:${errorStamp}`
    const folded = foldSession(rows.messages, rows.parts, undefined, false, errors)
    // The catalogue is read again only for a model the session has not answered with before.
    if (folded.model !== null && this.title?.model !== folded.model) this.title = { model: folded.model, title: await modelTitle(this.home, folded.model) }
    this.folded = withTitle(folded, folded.model === null ? null : (this.title?.title ?? null))
  }
}
