import { isInside } from '../paths.js'
import type { AgentEntry } from './agents.js'

export interface Occupant {
  agent: AgentEntry
  task: string
}

export function slotOccupants(
  agents: AgentEntry[],
  owners: Map<string, string>,
  slot: string,
  task: string,
): { idle: Occupant[]; busy: Occupant[] } {
  const idle: Occupant[] = []
  const busy: Occupant[] = []
  for (const agent of agents) {
    const owner = owners.get(agent.sessionId)
    if (owner === undefined || owner === task || agent.id === undefined || !isInside(agent.cwd, slot)) continue
    if (agent.state === 'stopped' || agent.state === 'failed') continue
    ;(agent.status === 'busy' || agent.status === 'shell' || agent.status === 'waiting' ? busy : idle).push({ agent, task: owner })
  }
  return { idle, busy }
}
