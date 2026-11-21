import { isLive, type AgentEntry } from './agents.js'

/** A live session mid-turn; `shell` counts, since its turn goes on once the background command is done. */
function inTurn(agent: AgentEntry): boolean {
  return isLive(agent) && (agent.status === 'busy' || agent.status === 'shell')
}

/**
 * Which sessions' turns ended since the last listing (BTN-1274, the push at the end of a turn in
 * `docs/chain/worktrees.md`): a session mid-turn before and not now, or a live one first seen between turns (the
 * service's start). A dead session first seen is left out: its folder may be long gone.
 */
export class TurnEnds {
  private turning = new Map<string, boolean>()

  ended(list: readonly AgentEntry[]): AgentEntry[] {
    const ended = list.filter((agent) => {
      if (inTurn(agent)) return false
      const before = this.turning.get(agent.sessionId)
      return before === true || (before === undefined && isLive(agent))
    })
    this.turning = new Map(list.map((agent) => [agent.sessionId, inTurn(agent)]))
    return ended
  }
}
