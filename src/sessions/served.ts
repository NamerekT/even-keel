import { handoffsOf } from '../chain/launches.js'
import type { LaunchEntry } from '../chain/model.js'
import { isChatSession } from '../chats/model.js'
import type { SessionView } from '../state.js'
import type { ApprovalDecision, Approvals } from './approvals.js'

/**
 * A session the service started, whose hooks it answers: a launch of the chain (its journal) or a project chat (its
 * views). A session started by hand is neither and gets a 404.
 */
export function servedSession(launches: LaunchEntry[], views: readonly Pick<SessionView, 'task' | 'sessionId'>[], sessionId: string): boolean {
  return handoffsOf(launches, sessionId) !== undefined || isChatSession(views, sessionId)
}

interface ServingMachine {
  journal: LaunchEntry[]
  sessions: readonly Pick<SessionView, 'task' | 'sessionId'>[]
  approvals: Pick<Approvals, 'poll'>
}

/**
 * The permission hook's poll on a machine elsewhere (`HookReceiver`, BTN-1769), by the machine's own journal, views
 * and approvals. Before the machine is up the call waits (`null`): a 404 would end the hook for good.
 */
export function machinePermission(machine: () => ServingMachine | undefined): (sessionId: string, tool: string, input: Record<string, unknown>, since: number) => ApprovalDecision | null | undefined {
  return (sessionId, tool, input, since) => {
    const up = machine()
    if (up === undefined) return null
    return servedSession(up.journal, up.sessions, sessionId) ? up.approvals.poll(sessionId, tool, input, since) : undefined
  }
}
