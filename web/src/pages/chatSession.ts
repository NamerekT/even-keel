import type { SessionView } from '../../../src/state.js'

export interface ChatSessionFacts {
  /** The session the chain talks to now: the current, an aside or a loose one; `null` — none. */
  talking: SessionView | null
  /** The last session the chat talked to. */
  last: SessionView | null
  /** The chat window is open. */
  chatting: boolean
  /** The task is still open. */
  open: boolean
  /** The state's sessions. */
  sessions: SessionView[]
}

export interface ChatSession {
  session: SessionView | null
  /** The window keeps reading the transcript as it grows. */
  live: boolean
}

/**
 * The session an open chat window shows. A reply respawns the session and a handoff waits for the next one: for those
 * seconds the window stays on the last view and keeps reading. After Done the window stays on the last session too, but
 * as the state sees it now — it is still writing its closing message, and the window reads its turn to the end; a
 * session gone from the state is over (BTN-1018).
 */
export function chatSessionOf({ talking, last, chatting, open, sessions }: ChatSessionFacts): ChatSession {
  if (talking !== null) return { session: talking, live: talking.lamp !== 'finished' }
  if (!chatting || last === null) return { session: null, live: false }
  if (open) return { session: last, live: true }
  const now = sessions.find((view) => view.sessionId === last.sessionId) ?? { ...last, lamp: 'finished' as const }
  return { session: now, live: now.lamp !== 'finished' }
}
