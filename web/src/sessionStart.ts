import type { CurrentTask } from '../../src/chain/dispatcher.js'
import type { TaskSession } from '../../src/chain/launches.js'
import { BOOT_WAIT_MS, idleBeforePrompt } from '../../src/sessions/boot.js'
import type { SessionView } from '../../src/state.js'

/**
 * `launch`, `handover` — the service is starting the session; `resume` — it continues the same session after a limit
 * or a temporary error (EKR-120); `boot` — the page does not see the new session yet; `answer` — the session is up and
 * has not answered yet.
 */
export interface SessionStart {
  phase: StartPhase
  since: string
}

export type StartPhase = 'launch' | 'handover' | 'resume' | 'boot' | 'answer'

export function sessionStart(current: CurrentTask, session: SessionView | null, runs: TaskSession[], now: Date): SessionStart | null {
  if (current.sessionId === null) return { phase: 'launch', since: current.starting ?? current.since }
  if (current.answering) return null
  if (current.starting !== undefined) return { phase: current.move === 'resume' ? 'resume' : 'handover', since: current.starting }
  const run = runs.find((each) => each.sessionId === current.sessionId)
  if (run !== undefined && run.answers + run.resumed > 0) return null
  const seen = session?.sessionId === current.sessionId ? session : null
  const since = run?.at ?? seen?.startedAt
  if (since === undefined || now.getTime() - Date.parse(since) > BOOT_WAIT_MS) return null
  if (seen === null) return { phase: 'boot', since }
  if (seen.contextTokens > 0) return null
  return seen.lamp === 'working' ? { phase: 'answer', since } : idleBeforePrompt(seen, now) ? { phase: 'boot', since } : null
}
