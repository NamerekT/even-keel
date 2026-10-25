import { describe, expect, it } from 'vitest'
import { notice } from '../src/notice/notice.js'
import { checkCodexHookList, checkHookRequests, checkRolloutUsage, checkUsage } from './cli-check-support.js'

const tokenCount = (rate_limits: unknown) => JSON.stringify({ type: 'event_msg', timestamp: '2026-10-25T10:00:00Z', payload: { type: 'token_count', rate_limits } })
const month = { used_percent: 100, window_minutes: 43200, resets_at: 1795000000 }

describe('CLI check limits', () => {
  it('checks the monthly window from this rollout, retaining it after a windowless premium event', () => {
    expect(checkRolloutUsage([tokenCount({ primary: month }), tokenCount({ limit_id: 'premium', primary: null, secondary: null })].join('\n'))).toContain('30d 100 %')
  })

  it.each([
    { limit_id: 'premium', primary: null, secondary: null },
    { primary: { ...month, window_minutes: 123 } },
    { future_windows: [month] },
    {},
  ])('rejects unparsed rate_limits and includes the received shape: %j', (raw) => {
    expect(() => checkRolloutUsage(tokenCount(raw))).toThrow(JSON.stringify(raw))
  })

  it('reports explicit no data when the rollout supplies no rate_limits', () => {
    expect(checkRolloutUsage(tokenCount(null))).toContain('no data')
    expect(checkRolloutUsage('')).toContain('no data')
  })

  it('shows the raw evidence if the event envelope changes or a window cannot be parsed', () => {
    const raw = { primary: month }
    expect(() => checkRolloutUsage(JSON.stringify({ type: 'event_msg', payload: { type: 'future_limits', rate_limits: raw } }))).toThrow(JSON.stringify(raw))
    const invalid = { primary: { ...month, resets_at: 1e100 } }
    expect(() => checkRolloutUsage(tokenCount(invalid))).toThrow(JSON.stringify(invalid))
  })

  it('accepts an adapter missing answer and rejects an unknown one', () => {
    expect(checkUsage({ kind: 'missing', reason: notice('usage.noLimits', {}) })).toContain('no data')
    expect(() => checkUsage({ kind: 'unknown', reason: notice('usage.noLimits', {}) })).toThrow('unknown')
  })

  it('rejects an empty limits answer', () => {
    expect(() => checkUsage({ kind: 'limits', limits: { fiveHour: null, sevenDay: null, source: 'usage', updatedAt: '2026-10-25T10:00:00Z' } })).toThrow('no displayable window')
  })
})

describe('CLI check hook evidence', () => {
  it('requires every listed Codex hook to be trusted, with a diagnostic for an empty list', () => {
    const list = (trustStatus: string) => ({ data: [{ hooks: [{ pluginId: 'checkpoint@ek-check', key: 'stop-hook', trustStatus }] }] })
    expect(checkCodexHookList(list('trusted'), 'checkpoint@ek-check')).toContain('1 trusted')
    expect(() => checkCodexHookList(list('modified'), 'checkpoint@ek-check')).toThrow('stop-hook modified')
    expect(() => checkCodexHookList({ data: [] }, 'checkpoint@ek-check')).toThrow('received {"data":[]}')
  })

  it('requires a hook request for one of the checked session ids', () => {
    expect(() => checkHookRequests([{ session: 'other', path: '/checkpoint' }], ['checked'])).toThrow('other')
    expect(() => checkHookRequests([], ['checked'])).toThrow('no checkpoint package hook request')
    expect(checkHookRequests([{ session: 'checked', path: '/mail' }], ['checked'])).toContain('/mail')
  })
})
