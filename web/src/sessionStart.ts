import type { CurrentTask } from '../../src/chain/dispatcher.js'
import type { TaskSession } from '../../src/chain/launches.js'
import { userMessageOf } from '../../src/chain/user-message.js'
import type { Notice } from '../../src/notice/notice.js'
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

/** "New session with this message" on its way (BTN-1281), as the chat shows it from the press until the new session is up. */
export interface ChatHandover {
  phase: 'handover' | 'boot' | 'answer'
  /** When the handover began. */
  since: string
  /** The user's message as they wrote it; `null` — not known. */
  message: string | null
  /** The new session once the service knows it; `null` while it is being started. */
  sessionId: string | null
  /** The handover failed and paused the chain. */
  error?: Notice
}

/** `failed` — the error the task's chain is paused on, if it is. */
export function chatHandover(current: CurrentTask, start: SessionStart | null, runs: TaskSession[], failed: Notice | null): ChatHandover | null {
  if (current.starting !== undefined && current.move === 'message') {
    const handover: ChatHandover = { phase: 'handover', since: current.starting, message: userMessageOf(current.reply), sessionId: null }
    return failed === null ? handover : { ...handover, error: failed }
  }
  if (start === null || (start.phase !== 'boot' && start.phase !== 'answer') || current.sessionId === null) return null
  // The journal's run of the new session may reach the page after the task's new session id.
  const run = runs.find((each) => each.sessionId === current.sessionId)
  if (run === undefined ? current.message === undefined : run.cause !== 'message') return null
  return { phase: start.phase, since: run?.at ?? start.since, message: current.message ?? null, sessionId: current.sessionId }
}
