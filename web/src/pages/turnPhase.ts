import type { Turn } from '../../../src/sessions/transcript.js'

/** Longest an answer is taken to be on its way: the service's hold on a resumed session (`src/sessions/holds.ts`). */
const DELIVERY_MS = 3 * 60_000

export interface TurnFacts {
  /** The session's lamp is `working`. */
  working: boolean
  /** The last turn of the session's transcript. */
  turn: Turn | null
  /** When the transcript's last prompt or answer was written. */
  lastReplyAt: string | null
  /** The moments the latest answers to the session are known by: sent from the chat, taken by the service. */
  answers: string[]
  /** The service is delivering an answer to the session now. */
  delivering: boolean
}

/**
 * What the chat's turn line says: an answer on its way — the session is stopped and respawned with it, the
 * transcript still ends in the turn before; then the turn: thinking or running a tool. The clock runs from the send of
 * the answer into the turn it began, so it does not jump back when the answer's prompt lands.
 */
export type TurnPhase =
  | { kind: 'delivering'; since: string }
  | { kind: 'thinking'; since: string | null }
  | { kind: 'running'; tool: string; since: string | null }

export function turnPhase(facts: TurnFacts, now: number): TurnPhase | null {
  if (!facts.working) return null
  const moments = facts.answers.map((at) => Date.parse(at)).filter((at) => Number.isFinite(at))
  const latest = moments.length === 0 ? null : Math.max(...moments)
  // The chat's send and the service's take of one answer are a moment apart: the clock runs from the first.
  const answer = latest === null ? null : Math.min(...moments.filter((at) => at >= latest - DELIVERY_MS))
  const turnAt = facts.turn === null || facts.turn.startedAt === '' ? null : Date.parse(facts.turn.startedAt)
  if (answer !== null && latest !== null) {
    const landed =
      !facts.delivering &&
      ((turnAt !== null && turnAt >= answer) || (facts.lastReplyAt !== null && Date.parse(facts.lastReplyAt) >= answer) || now - latest > DELIVERY_MS)
    if (!landed) return { kind: 'delivering', since: new Date(answer).toISOString() }
  }
  if (facts.turn === null) return null
  const since = turnAt === null ? null : answer !== null && turnAt <= answer + DELIVERY_MS ? new Date(answer).toISOString() : facts.turn.startedAt
  return facts.turn.tool === null ? { kind: 'thinking', since } : { kind: 'running', tool: facts.turn.tool, since }
}
