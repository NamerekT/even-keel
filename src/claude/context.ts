// The context window a model runs with, as the CLI's local `/context` reports it (BTN-187): no turn, no cost.

const TOKENS = /\*\*Tokens:\*\*\s*[\d.]+\s*[km]?\s*\/\s*([\d.]+)\s*([km]?)\s*\(/i
const SCALE: Record<string, number> = { '': 1, k: 1_000, m: 1_000_000 }

/** `claude -p /context`: its own settings (`--settings`) are a chain session's, so the window is the one the session gets. */
export function contextArgs(model: string, settings?: string): string[] {
  return [
    '-p',
    '/context',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--model',
    model,
    ...(settings === undefined ? [] : ['--settings', settings]),
  ]
}

/** The window of the `**Tokens:** 23.8k / 250k (10%)` line; `null` — the answer has no such line. */
export function parseContextWindow(stdout: string): number | null {
  let answer: { is_error?: unknown; result?: unknown }
  try {
    answer = JSON.parse(stdout) as typeof answer
  } catch {
    return null
  }
  if (answer.is_error === true || typeof answer.result !== 'string') return null
  const match = TOKENS.exec(answer.result)
  if (match === null) return null
  const window = Math.round(Number(match[1]) * SCALE[match[2]!.toLowerCase()]!)
  return Number.isFinite(window) && window > 0 ? window : null
}
