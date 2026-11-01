import { isLive, type AgentEntry } from './agents.js'

/**
 * The sessions a cleanup after Done found mid-turn and left running (BTN-616): nothing else stops them once their task
 * has left the chain, and a Codex session would rest as `waiting` for good. Each is stopped once its turn ends
 * (exception 4 of invariant 1). In memory: a restart loses them, as it loses the cleanup that kept them.
 */
export class Lingering {
  /** By session id, the task each belongs to. */
  private readonly sessions = new Map<string, string>()

  keep(task: string, sessionId: string): void {
    this.sessions.set(sessionId, task)
  }

  /** The kept sessions whose turn has ended, to stop now, forgotten as they are given; a session gone meanwhile is forgotten too. */
  due(agents: AgentEntry[], busy: (agent: AgentEntry) => boolean): { task: string; agent: AgentEntry }[] {
    const due: { task: string; agent: AgentEntry }[] = []
    for (const [sessionId, task] of this.sessions) {
      const agent = agents.find((each) => each.sessionId === sessionId)
      if (agent !== undefined && isLive(agent) && busy(agent)) continue
      this.sessions.delete(sessionId)
      if (agent !== undefined && isLive(agent)) due.push({ task, agent })
    }
    return due
  }
}
