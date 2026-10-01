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

const SESSION = 'Current session: 33% used · resets Sep 27, 7:49pm (Europe/Berlin)'
const WEEK = 'Current week (all models): 19% used · resets Oct 3, 2:59pm (Europe/Berlin)'
const lines = (...rows: string[]) => rows.join('\n')

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
        source: 'usage',
      },
    })
  })

  it('puts a reset early in January into the next year', () => {
    const text = lines('Current session: 2% used · resets 11pm (Europe/Berlin)', 'Current week (all models): 100% used · resets Jan 2, 9am (Europe/Berlin)')
    const parsed = parseUsage(answer(text), '2026-12-31T20:00:00.000Z')

    expect(parsed.kind === 'limits' && parsed.limits.sevenDay).toEqual({ usedPercentage: 100, resetsAt: '2027-01-02T08:00:00.000Z' })
  })

  it('takes an unused window without a reset time as not started', () => {
    const parsed = parseUsage(answer(lines('Current session: 0% used', WEEK)), AT)

    expect(parsed.kind === 'limits' && parsed.limits.fiveHour).toBeNull()
    expect(parsed.kind === 'limits' && parsed.limits.sevenDay).toEqual({ usedPercentage: 19, resetsAt: '2026-10-03T12:59:00.000Z' })
  })

  it.each([
    ['the weekly line is missing', lines(SESSION, 'Current week (Sonnet only): 80% used · resets Oct 3, 2:59pm (Europe/Berlin)'), /week/],
    ['the session line is missing', WEEK, /session/],
    ['a used window has no reset time', lines('Current session: 33% used', WEEK), /session/],
    ['the reset time is in another format', lines('Current session: 33% used · resets 19:49 (Europe/Berlin)', WEEK), /session/],
    ['the percentage is in another format', lines('Current session: 33 % used · resets 7:49pm (Europe/Berlin)', WEEK), /session/],
    ['no limit lines at all', 'Usage is only available for subscription plans.', /session/],
  ])('rejects the whole answer when %s', (_case, text, reason) => {
    const parsed = parseUsage(answer(text), AT)

    expect(parsed.kind).toBe('unknown')
    expect(parsed.kind === 'unknown' && parsed.reason).toMatch(reason)
  })

  it('reports a subscription answer without any limit lines as missing data, not a new format', () => {
    const text = lines(
      'You are currently using your subscription to power your Claude Code usage',
      '',
      "What's contributing to your limits usage?",
      'Last 24h · 82 requests · 6 sessions',
    )
    const parsed = parseUsage(answer(text), AT)

    expect(parsed.kind).toBe('missing')
  })

  it('reports an answer that went to the model instead of the local command', () => {
    expect(parseUsage(answer('Sure, here is how usage works…', { num_turns: 1, total_cost_usd: 0.16 }), AT).kind).toBe('spent')
    expect(parseUsage(answer(TEXT, { num_turns: 0, total_cost_usd: 0.01 }), AT).kind).toBe('spent')
  })

  it.each([
    ['num_turns is missing', { num_turns: undefined }],
    ['total_cost_usd is missing', { total_cost_usd: undefined }],
    ['num_turns is not a number', { num_turns: '0' }],
    ['total_cost_usd is not a number', { total_cost_usd: null }],
  ])('treats an answer as spent unless it says no turn was taken: %s', (_case, overrides) => {
    const parsed = parseUsage(answer(TEXT, overrides), AT)

    expect(parsed.kind).toBe('spent')
    expect(parsed.kind === 'spent' && parsed.reason).toMatch(/num_turns|total_cost_usd/)
  })

  it('does not know an error answer or a broken output', () => {
    expect(parseUsage(answer(TEXT, { is_error: true }), AT)).toMatchObject({ kind: 'unknown', reason: expect.stringMatching(/error/) })
    expect(parseUsage('Error: unknown option', AT)).toMatchObject({ kind: 'unknown', reason: expect.stringMatching(/JSON/) })
    expect(parseUsage('[]', AT)).toMatchObject({ kind: 'unknown', reason: expect.stringMatching(/JSON/) })
  })
})
