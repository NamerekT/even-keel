import { describe, expect, it } from 'vitest'
import { limitOfResponse, rateLimitOf, TrackerRateLimited, untilOf } from './rate-limit.js'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const answer = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) })

describe('limitOfResponse', () => {
  it('takes a 429 with retry-after in seconds as a wait from now', () => {
    const limit = limitOfResponse('gitlab', answer(429, { 'retry-after': '90' }), '', NOW)
    expect(limit).toBeInstanceOf(TrackerRateLimited)
    expect(limit?.until?.toISOString()).toBe('2026-11-21T12:01:30.000Z')
  })

  it('takes retry-after as an HTTP date', () => {
    expect(limitOfResponse('jira', answer(429, { 'retry-after': 'Sat, 21 Nov 2026 12:05:00 GMT' }), '', NOW)?.until?.toISOString()).toBe('2026-11-21T12:05:00.000Z')
  })

  it('takes a 403 with nothing left in the window until its reset in epoch seconds', () => {
    const limit = limitOfResponse('github', answer(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 600) }), 'API rate limit exceeded', NOW)
    expect(limit?.until?.toISOString()).toBe('2026-11-21T12:10:00.000Z')
  })

  it("takes GitHub's secondary limit without headers as a limit with no time", () => {
    const limit = limitOfResponse('github', answer(403), 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.', NOW)
    expect(limit).toBeInstanceOf(TrackerRateLimited)
    expect(limit?.until).toBeNull()
  })

  it('reads a reset in epoch milliseconds and as an ISO time', () => {
    expect(limitOfResponse('linear', answer(429, { 'x-ratelimit-requests-reset': String(NOW + 30_000) }), '', NOW)?.until?.toISOString()).toBe('2026-11-21T12:00:30.000Z')
    expect(limitOfResponse('jira', answer(429, { 'x-ratelimit-reset': '2026-11-21T12:02:00Z' }), '', NOW)?.until?.toISOString()).toBe('2026-11-21T12:02:00.000Z')
    expect(limitOfResponse('gitlab', answer(429, { 'ratelimit-reset': String(NOW / 1000 + 60) }), '', NOW)?.until?.toISOString()).toBe('2026-11-21T12:01:00.000Z')
  })

  it('leaves any other refusal alone', () => {
    expect(limitOfResponse('github', answer(403), 'Resource not accessible by integration', NOW)).toBeNull()
    expect(limitOfResponse('github', answer(403, { 'x-ratelimit-remaining': '12' }), 'Must have admin rights', NOW)).toBeNull()
    expect(limitOfResponse('gitlab', answer(500, { 'retry-after': '5' }), '', NOW)).toBeNull()
    expect(limitOfResponse('gitlab', answer(200, { 'x-ratelimit-remaining': '0' }), '', NOW)).toBeNull()
  })

  it('says the tracker and the time in its message', () => {
    expect(limitOfResponse('gitlab', answer(429, { 'retry-after': '90' }), '', NOW)?.message).toBe('gitlab: rate limited (HTTP 429) until 2026-11-21T12:01:30.000Z')
    expect(limitOfResponse('github', answer(403), 'You have exceeded a secondary rate limit', NOW)?.message).toBe('github: rate limited (HTTP 403): You have exceeded a secondary rate limit')
  })
})

describe('untilOf', () => {
  it('gives null without a header of the time', () => {
    expect(untilOf(new Headers(), NOW)).toBeNull()
    expect(untilOf(new Headers({ 'retry-after': 'soon' }), NOW)).toBeNull()
  })
})

describe('rateLimitOf', () => {
  it('finds the limit through the causes', () => {
    const limit = new TrackerRateLimited('linear: rate limited', new Date(NOW))
    expect(rateLimitOf(new Error('the write failed', { cause: limit }))).toBe(limit)
    expect(rateLimitOf(new Error('github: HTTP 502'))).toBeNull()
    expect(rateLimitOf('text')).toBeNull()
  })
})
