import type { ChainState } from './model.js'

// A fix or carry session the user skipped stays alive (invariant 1) under the name the next fix or carry of the
// project gets. The chain remembers it so that it never takes it for that next one (`MainGate.skippedSessions`).

export function rememberSkipped(state: ChainState, project: string, task: string, sessionId: string): void {
  const byName = ((state.ci[project] ??= {}).skippedSessions ??= {})
  const ids = (byName[task] ??= [])
  if (!ids.includes(sessionId)) ids.push(sessionId)
}

export function wasSkipped(state: ChainState, project: string, task: string, sessionId: string): boolean {
  return state.ci[project]?.skippedSessions?.[task]?.includes(sessionId) === true
}

/** The name's place is cleaned up, its sessions stopped with it. */
export function forgetSkipped(state: ChainState, project: string, task: string): void {
  const gate = state.ci[project]
  if (gate?.skippedSessions?.[task] === undefined) return
  delete gate.skippedSessions[task]
  if (Object.keys(gate.skippedSessions).length === 0) delete gate.skippedSessions
}
