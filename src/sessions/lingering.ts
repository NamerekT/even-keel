import { isLive, type AgentEntry } from './agents.js'

/** A kept session whose stop timed out in its folder's queue (EKR-99): tried again until `until`, then a warning of the project. */
export interface StopRetry {
  project: string
  until: number
}

/** A worktree folder git unregistered and left while a kept session of its task still held it (EKR-99). */
export interface LeftFolder {
  project: string
  task: string
  repo: string
  path: string
  until: number
}

interface Kept {
  task: string
  retry?: StopRetry
}

/**
 * The sessions a cleanup after Done left running (BTN-616): found mid-turn, or whose stop timed out (EKR-99). Nothing
 * else stops them once their task has left the chain, and a Codex session would rest as `waiting` for good. Each is
 * stopped once its turn ends (exception 4 of invariant 1), and the worktree folder it held is removed after it. In
 * memory: a restart loses them, as it loses the cleanup that kept them.
 */
export class Lingering {
  /** By session id. */
  private readonly sessions = new Map<string, Kept>()
  private readonly folders = new Map<string, LeftFolder>()
  private running = false

  keep(task: string, sessionId: string, retry?: StopRetry): void {
    this.sessions.set(sessionId, retry === undefined ? { task } : { task, retry })
  }

  leave(folder: LeftFolder): void {
    this.folders.set(folder.path, folder)
  }

  /** The kept sessions whose turn has ended, to stop now, forgotten as they are given; a session gone meanwhile is forgotten too. */
  due(agents: AgentEntry[], busy: (agent: AgentEntry) => boolean): { task: string; agent: AgentEntry; retry?: StopRetry }[] {
    const due: { task: string; agent: AgentEntry; retry?: StopRetry }[] = []
    for (const [sessionId, { task, retry }] of this.sessions) {
      const agent = agents.find((each) => each.sessionId === sessionId)
      if (agent !== undefined && isLive(agent) && busy(agent)) continue
      this.sessions.delete(sessionId)
      if (agent !== undefined && isLive(agent)) due.push(retry === undefined ? { task, agent } : { task, agent, retry })
    }
    return due
  }

  /** The left folders to remove now, forgotten as they are given: no session of their task is kept any more, or their wait is over. */
  dueFolders(now: number): LeftFolder[] {
    const held = new Set([...this.sessions.values()].map((kept) => kept.task))
    const due = [...this.folders.values()].filter((folder) => !held.has(folder.task) || now >= folder.until)
    for (const folder of due) this.folders.delete(folder.path)
    return due
  }

  /** Runs `work` unless the previous run is under way: otherwise a tick would remove a folder while the previous one still stops its session. */
  async alone(work: () => Promise<void>): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await work()
    } finally {
      this.running = false
    }
  }
}
