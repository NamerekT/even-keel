import { notice, type Notice } from '../notice/notice.js'

/** What still holds a project the page asks to remove. */
export interface RemovalFacts {
  project: string
  /** Its chain runs, is paused or waits in the queue. */
  chain: boolean
  /** Live sessions of its tasks or in its folders, as `<task> (<session id>)`. */
  sessions: string[]
  /** Tasks whose worktree or slot the chain still holds (`Dispatcher.held`). */
  held: string[]
  /** Tasks whose place the cleanup after Done left behind. */
  leftovers: string[]
}

/** Why the project cannot be removed yet, each reason an item; `null` — nothing holds it. */
export function removalBlock(facts: RemovalFacts): Notice | null {
  const items: Notice[] = []
  if (facts.chain) items.push(notice('project.removeChain', {}))
  if (facts.sessions.length > 0) items.push(notice('project.removeSessions', { sessions: facts.sessions }))
  if (facts.held.length > 0) items.push(notice('project.removePlaces', { tasks: facts.held }))
  if (facts.leftovers.length > 0) items.push(notice('project.removeLeftovers', { tasks: facts.leftovers }))
  return items.length === 0 ? null : notice('project.removeBlocked', { project: facts.project }, { items })
}
