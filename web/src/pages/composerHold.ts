import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'

export type HeldSession = Pick<SessionView, 'sessionId' | 'lamp' | 'ask' | 'lastActivityAt'>

/**
 * What the composer, shut after a reply, waits on to change. The last transcript line moves with every turn: a short
 * one that ends between two updates of the state leaves the lamp `waiting` and the question as it was (BTN-220).
 */
export function holdKey(session: HeldSession): string {
  return `${session.sessionId}|${session.lamp}|${session.ask?.id ?? ''}|${session.lastActivityAt ?? ''}`
}

/**
 * The question the composer offers: never one the feed already holds an answer to, which a session stopped and
 * resumed to take it may still give for a few seconds (BTN-921).
 */
export function shownAsk(ask: SessionView['ask'], answered: ReadonlySet<string>): SessionView['ask'] {
  return ask !== null && !answered.has(ask.id) ? ask : null
}

/** The questions the feed holds answers to: answer lines of the transcript and replies sent from the page. */
export function answeredAsks(lines: readonly FeedLine[]): Set<string> {
  return new Set(lines.flatMap((line) => (line.answers?.ask === undefined ? [] : [line.answers.ask])))
}

/** Sends a reply already shown: `show` puts it in place before the server answers and gives what takes it back on a refusal. */
export async function sendAhead(show: () => () => void, send: () => Promise<boolean>): Promise<boolean> {
  const retract = show()
  const ok = await send()
  if (!ok) retract()
  return ok
}
