import { describe, expect, it } from 'vitest'
import { parseUsage } from './usage.js'

const AT = '2026-09-27T15:00:00.000Z'

const TEXT = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 33% used · resets Sep 27, 7:49pm (Europe/Berlin)',
  'Current week (all models): 19% used · resets Oct 3, 2:59pm (Europe/Berlin)',
  '',
  "What's contributing to your limits usage?",
  'Last 24h · 2776 requests · 43 sessions',
].join('\n')

function answer(result: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 0, total_cost_usd: 0, result, ...overrides })
}

describe('parseUsage', () => {
  it('reads the session and the weekly window from the /usage answer', () => {
    expect(parseUsage(answer(TEXT), AT)).toEqual({
      kind: 'limits',
      limits: {
        fiveHour: { usedPercentage: 33, resetsAt: '2026-09-27T17:49:00.000Z' },
        sevenDay: { usedPercentage: 19, resetsAt: '2026-10-03T12:59:00.000Z' },
        updatedAt: AT,
      },
    })
  })

  it('puts a reset early in January into the next year', () => {
    const text = 'Current week (all models): 100% used · resets Jan 2, 9am (Europe/Berlin)'
    const parsed = parseUsage(answer(text), '2026-12-31T20:00:00.000Z')

    expect(parsed).toEqual({
      kind: 'limits',
      limits: { fiveHour: null, sevenDay: { usedPercentage: 100, resetsAt: '2027-01-02T08:00:00.000Z' }, updatedAt: '2026-12-31T20:00:00.000Z' },
    })
  })

  it('does not take a per-model weekly line for the all-models window', () => {
    const text = 'Current session: 5% used · resets 9pm (Europe/Berlin)\nCurrent week (Sonnet only): 80% used · resets Oct 3, 2:59pm (Europe/Berlin)'
    const parsed = parseUsage(answer(text), AT)

    expect(parsed.kind === 'limits' && parsed.limits.sevenDay).toBeNull()
    expect(parsed.kind === 'limits' && parsed.limits.fiveHour).toEqual({ usedPercentage: 5, resetsAt: '2026-09-27T19:00:00.000Z' })
  })

  it('leaves out a window whose reset time it cannot read', () => {
    const parsed = parseUsage(answer('Current session: 0% used\nCurrent week (all models): 19% used · resets Oct 3, 2:59pm (Europe/Berlin)'), AT)

    expect(parsed.kind === 'limits' && parsed.limits.fiveHour).toBeNull()
  })

  it('reports an answer that went to the model instead of the local command', () => {
    expect(parseUsage(answer('Sure, here is how usage works…', { num_turns: 1, total_cost_usd: 0.16 }), AT)).toEqual({ kind: 'spent' })
    expect(parseUsage(answer(TEXT, { num_turns: 0, total_cost_usd: 0.01 }), AT)).toEqual({ kind: 'spent' })
  })

  it('does not know an answer without the limit lines, an error or a broken output', () => {
    expect(parseUsage(answer('Usage is only available for subscription plans.'), AT)).toEqual({ kind: 'unknown' })
    expect(parseUsage(answer(TEXT, { is_error: true }), AT)).toEqual({ kind: 'unknown' })
    expect(parseUsage('Error: unknown option', AT)).toEqual({ kind: 'unknown' })
    expect(parseUsage('[]', AT)).toEqual({ kind: 'unknown' })
  })
})
