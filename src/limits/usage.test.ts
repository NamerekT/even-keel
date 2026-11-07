import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { modelWeeksOf, parseUsage } from './usage.js'
import { englishOf, notice } from '../notice/notice.js'

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

  it('reads a plan without the five-hour window, a verified Ultra, from its two weekly lines', () => {
    const text = lines(WEEK, 'Current week (Fable): 40% used · resets Oct 3, 2:59pm (Europe/Berlin)')

    expect(parseUsage(answer(text), AT)).toEqual({
      kind: 'limits',
      limits: { fiveHour: null, sevenDay: { usedPercentage: 19, resetsAt: '2026-10-03T12:59:00.000Z' }, absent: ['fiveHour'], updatedAt: AT, source: 'usage' },
    })
  })

  it('reads a seat without the all-models week, a Team one, from its session and model week', () => {
    const text = lines(SESSION, 'Current week (Fable): 80% used · resets Oct 3, 2:59pm (Europe/Berlin)')

    expect(parseUsage(answer(text), AT)).toEqual({
      kind: 'limits',
      limits: { fiveHour: { usedPercentage: 33, resetsAt: '2026-09-27T17:49:00.000Z' }, sevenDay: null, absent: ['sevenDay'], updatedAt: AT, source: 'usage' },
    })
  })

  it.each([
    ['the weekly line is in another format', lines(SESSION, 'Current week (all models): 19 % used · resets Oct 3, 2:59pm (Europe/Berlin)'), /week/],
    ['the session line is in another format without a weekly line', 'Current session: 33 % used', /session/],
    ['a used window has no reset time', lines('Current session: 33% used', WEEK), /session/],
    ['the reset time is in another format', lines('Current session: 33% used · resets 19:49 (Europe/Berlin)', WEEK), /session/],
    ['the percentage is in another format', lines('Current session: 33 % used · resets 7:49pm (Europe/Berlin)', WEEK), /session/],
    ['no limit lines at all', 'Usage is only available for subscription plans.', /session/],
  ])('rejects the whole answer when %s', (_case, text, reason) => {
    const parsed = parseUsage(answer(text), AT)

    expect(parsed.kind).toBe('unknown')
    expect(parsed.kind === 'unknown' && englishOf(parsed.reason)).toMatch(reason)
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
    expect(parsed.kind === 'spent' && englishOf(parsed.reason)).toMatch(/num_turns|total_cost_usd/)
  })

  it('does not know an error answer or a broken output', () => {
    expect(parseUsage(answer(TEXT, { is_error: true }), AT)).toEqual({ kind: 'unknown', reason: notice('usage.isError', {}) })
    expect(parseUsage('Error: unknown option', AT)).toEqual({ kind: 'unknown', reason: notice('usage.notJson', {}) })
    expect(parseUsage('[]', AT)).toEqual({ kind: 'unknown', reason: notice('usage.notObject', {}) })
  })
})

const sample = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/limits/${name}`, import.meta.url), 'utf8')) as { limits: unknown }

describe('modelWeeksOf', () => {
  it('reads the model week of a Max plan, named by the server, without a reset the answer did not give', () => {
    expect(modelWeeksOf(sample('claude-max-oauth-usage.json').limits)).toEqual([{ model: 'Fable', usedPercentage: 100, resetsAt: null }])
  })

  it.each(['claude-ultra-oauth-usage.json', 'claude-team-oauth-usage.json'])('reads the model week of %s, whose rows carry only a kind, a percent and a scope', (file) => {
    expect(modelWeeksOf(sample(file).limits)).toEqual([{ model: 'Fable', usedPercentage: 0, resetsAt: null }])
  })

  it('takes the reset of a row that has one', () => {
    const rows = [{ kind: 'weekly_scoped', percent: 37.5, resets_at: '2030-01-10T16:00:00.000000+00:00', scope: { model: { display_name: 'Fable' } } }]

    expect(modelWeeksOf(rows)).toEqual([{ model: 'Fable', usedPercentage: 37.5, resetsAt: '2030-01-10T16:00:00.000Z' }])
  })

  it('finds no model week in rows that have none: the plan has none', () => {
    expect(modelWeeksOf([{ kind: 'session', percent: 22 }, { kind: 'weekly_all', percent: 61 }])).toEqual([])
    expect(modelWeeksOf([])).toEqual([])
  })

  it('skips a scoped row of a surface, or one without a model name or a percent', () => {
    const rows = [
      { kind: 'weekly_scoped', percent: 10, scope: { surface: { display_name: 'Cowork' } } },
      { kind: 'weekly_scoped', percent: 10, scope: { model: { display_name: '' } } },
      { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } } },
    ]

    expect(modelWeeksOf(rows)).toEqual([])
  })

  it('knows nothing without the rows', () => {
    expect(modelWeeksOf(null)).toBeUndefined()
    expect(modelWeeksOf(undefined)).toBeUndefined()
  })
})

describe('parseUsage on the stream', () => {
  const report = (limits: unknown) => ({ session: {}, rate_limits: limits === undefined ? null : { limits } })
  const stream = (usageReport?: unknown) => [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: TEXT }] }, local_command_source: 'usage', ...(usageReport !== undefined && { usage_report: usageReport }) }),
    answer(TEXT),
  ].join('\n')

  it('reads the windows from the result line and the model weeks from the usage report', () => {
    const parsed = parseUsage(stream(report(sample('claude-max-oauth-usage.json').limits)), AT)

    expect(parsed).toEqual({
      kind: 'limits',
      limits: {
        fiveHour: { usedPercentage: 33, resetsAt: '2026-09-27T17:49:00.000Z' },
        sevenDay: { usedPercentage: 19, resetsAt: '2026-10-03T12:59:00.000Z' },
        models: { weeks: [{ model: 'Fable', usedPercentage: 100, resetsAt: null }], updatedAt: AT },
        updatedAt: AT,
        source: 'usage',
      },
    })
  })

  it('says the plan has no model week when the report lists no such row', () => {
    const parsed = parseUsage(stream(report([{ kind: 'session', group: 'session', percent: 33, resets_at: null, severity: 'normal', is_active: true }])), AT)

    expect(parsed.kind === 'limits' && parsed.limits.models).toEqual({ weeks: [], updatedAt: AT })
  })

  it('knows no model weeks without a report, or with a report the CLI could not fill', () => {
    for (const output of [stream(), stream(report(undefined)), stream({ session: {}, rate_limits: { limits: null } }), answer(TEXT)]) {
      const parsed = parseUsage(output, AT)
      expect(parsed.kind).toBe('limits')
      expect(parsed.kind === 'limits' && parsed.limits).not.toHaveProperty('models')
    }
  })

  it('reads the same messages printed as one array', () => {
    const messages = stream(report([])).split('\n').map((line) => JSON.parse(line) as unknown)

    expect(parseUsage(JSON.stringify(messages), AT)).toEqual(parseUsage(stream(report([])), AT))
  })

  it('does not know a stream without its result line', () => {
    expect(parseUsage(stream(report([])).split('\n').slice(0, 2).join('\n'), AT)).toEqual({ kind: 'unknown', reason: notice('usage.notObject', {}) })
  })
})
