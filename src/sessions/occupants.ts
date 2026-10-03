import { resolve, sep } from 'node:path'
import type { AgentEntry } from './agents.js'

export interface Occupant {
  agent: AgentEntry
  task: string
}

export function isInside(cwd: string, folder: string): boolean {
  const path = resolve(cwd).toLowerCase()
  const root = resolve(folder).toLowerCase()
  return path === root || path.startsWith(`${root}${sep}`)
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
    ;(agent.status === 'busy' || agent.status === 'waiting' ? busy : idle).push({ agent, task: owner })
  }
  return { idle, busy }
}
