import { CLAUDE } from '../claude/name.js'

/** How Claude sessions run: through the Agent SDK or `claude --bg` (BTN-239, `docs/sessions.md`). */
export type Transport = 'sdk' | 'bg'

export const TRANSPORTS: readonly Transport[] = ['sdk', 'bg']

/** The `execution.claude` that runs each account by its kind (`transportOf`), the setting's default (BTN-353). */
export const AUTO_EXECUTION = 'auto'

export function isTransport(value: unknown): value is Transport {
  return typeof value === 'string' && (TRANSPORTS as readonly string[]).includes(value)
}

/**
 * The transport of an account's new sessions by `execution.claude`: the one it names, else on `auto` the SDK on an API
 * key and `--bg` on a subscription, which Anthropic's terms do not clearly allow to drive through the SDK. `null` — the
 * account's agent has one way only.
 */
export function transportOf(agent: string, execution: string | undefined, apiKey: boolean): Transport | null {
  if (agent !== CLAUDE) return null
  if (isTransport(execution)) return execution
  return apiKey ? 'sdk' : 'bg'
}

/** A Claude account's transport chosen before schema v12. */
export interface TransportChoice {
  key: string
  transport: Transport
  apiKey: boolean
}

/**
 * The `execution.claude` the accounts' own choices become (BTN-353): `auto` when each is what `auto` gives its account,
 * the SDK when every one chose it, else `auto`, with the accounts whose way changes by it.
 */
export function executionOfChoices(choices: readonly TransportChoice[]): { execution: string; moved: TransportChoice[] } {
  const moved = choices.filter((choice) => choice.transport !== transportOf(CLAUDE, AUTO_EXECUTION, choice.apiKey))
  if (moved.length > 0 && choices.every((choice) => choice.transport === 'sdk')) return { execution: 'sdk', moved: [] }
  return { execution: AUTO_EXECUTION, moved }
}
