import { stat } from 'node:fs/promises'
import type { SessionTail } from '../agent/contract.js'
import type { AgentEntry } from './agents.js'
import { hungEntry } from './silence.js'

/** File writes include streaming and thinking records that the visible feed deliberately omits. */
export class TurnActivity {
  private readonly seen = new Map<string, { busy: boolean; pid: number | undefined; floor: number }>()

  async read(agent: AgentEntry, tail: SessionTail, now: number): Promise<AgentEntry> {
    const previous = this.seen.get(agent.sessionId)
    const busy = agent.status === 'busy' && agent.pid !== undefined
    const floor = busy && previous !== undefined && (!previous.busy || previous.pid !== agent.pid)
      ? now : previous?.floor ?? agent.processStartedAt ?? agent.startedAt
    this.seen.set(agent.sessionId, { busy, pid: agent.pid, floor })
    if (!busy || agent.silentSince !== undefined || tail.path === undefined) return agent
    const written = await stat(tail.path).then((info) => info.mtimeMs, () => undefined)
    return written === undefined ? agent : hungEntry(agent, Math.max(written, floor), now)
  }

  sweep(sessions: Set<string>): void {
    for (const id of this.seen.keys()) if (!sessions.has(id)) this.seen.delete(id)
  }
}
