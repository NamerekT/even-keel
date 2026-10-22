import { CLAUDE } from '../claude/name.js'

/** How an account's Claude sessions run: through the Agent SDK or `claude --bg` (BTN-239, `docs/sessions.md`). */
export type Transport = 'sdk' | 'bg'

export const TRANSPORTS: readonly Transport[] = ['sdk', 'bg']

export function isTransport(value: unknown): value is Transport {
  return typeof value === 'string' && (TRANSPORTS as readonly string[]).includes(value)
}

/**
 * The transport of an account's new sessions: the user's choice, else the SDK on an API key and `--bg` on a
 * subscription, which Anthropic's terms do not clearly allow to drive through the SDK. `null` — the account's agent
 * has one way only.
 */
export function transportOf(agent: string, chosen: Transport | undefined, apiKey: boolean): Transport | null {
  if (agent !== CLAUDE) return null
  return chosen ?? (apiKey ? 'sdk' : 'bg')
}
