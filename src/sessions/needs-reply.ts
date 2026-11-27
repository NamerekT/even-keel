import type { SessionView } from '../state.js'

/**
 * A real question, a permission or a startup dialog: the session waits for a person whatever else holds its task — a
 * refused close of its merged task, its landing (BTN-1779). The page and the README badge both read it.
 */
export function needsReply(session: Pick<SessionView, 'asking' | 'ask' | 'waitingFor' | 'startupDialog'>): boolean {
  return session.asking || session.ask !== null || session.waitingFor !== null || session.startupDialog !== null
}
