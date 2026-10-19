import type { SessionView } from '../../../src/state.js'

export type HeldSession = Pick<SessionView, 'sessionId' | 'lamp' | 'ask' | 'lastActivityAt'>

/**
 * What the composer, shut after a reply, waits on to change. The last transcript line moves with every turn: a short
 * one that ends between two updates of the state leaves the lamp `waiting` and the question as it was (BTN-220).
 */
export function holdKey(session: HeldSession): string {
  return `${session.sessionId}|${session.lamp}|${session.ask?.id ?? ''}|${session.lastActivityAt ?? ''}`
}

/** The question the composer offers: never the one it has answered, which the job file may give for a while longer. */
export function shownAsk(ask: SessionView['ask'], answered: string | null): SessionView['ask'] {
  return ask !== null && ask.id !== answered ? ask : null
}
