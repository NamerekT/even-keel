import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../sessions/transcript.js'
import { handoffPrompt, holdOf, relayStep, resetTimeOf, type LimitHold, type LimitedSession } from './relay.js'

const line = (text: string, kind: FeedLine['kind'] = 'tool'): FeedLine => ({ at: '2026-09-27T14:38:00.000Z', kind, text })

const session = (overrides: Partial<LimitedSession> = {}): LimitedSession => ({
  sessionId: 'abc-session',
  agentId: 'abc',
  cwd: 'D:/work/repo',
  workdir: 'D:/work/repo/.claude/worktrees/abc-1',
  branch: 'abc-1/some-work',
  transcript: 'C:/claude/projects/repo/abc-session.jsonl',
  limit: { at: '2026-09-27T14:39:02.453Z', text: "You've hit your session limit · resets 7:20pm (Europe/Berlin)" },
  lastReplyAt: '2026-09-27T14:38:50.000Z',
  recent: [],
  ...overrides,
})

const hold = (overrides: Partial<LimitHold> = {}): LimitHold => ({
  at: '2026-09-27T14:39:02.453Z',
  account: 'john@example.com',
  resetsAt: '2026-09-27T17:20:00.000Z',
  lastReplyAt: '2026-09-27T14:38:50.000Z',
  then: 'relay',
  acted: null,
  ...overrides,
})

const ready = { email: 'john@example.com', ready: true }

describe('resetTimeOf', () => {
  it('reads a clock time in the named zone on the day of the limit', () => {
    expect(resetTimeOf("You've hit your session limit · resets 7:20pm (Europe/Berlin)", '2026-09-27T14:39:02.453Z')).toBe(
      '2026-09-27T17:20:00.000Z',
    )
  })

  it('rolls a time already passed that day over to the next day', () => {
    expect(resetTimeOf('resets 1am (Europe/Berlin)', '2026-09-27T21:00:00.000Z')).toBe('2026-09-27T23:00:00.000Z')
  })

  it('reads a dated reset with the offset of that date', () => {
    expect(resetTimeOf("You've hit your weekly limit · resets Oct 30, 9am (Europe/Berlin)", '2026-10-27T10:00:00.000Z')).toBe(
      '2026-10-30T08:00:00.000Z',
    )
  })

  it('reads 12am and 12pm', () => {
    expect(resetTimeOf('resets 12pm (UTC)', '2026-09-27T08:00:00.000Z')).toBe('2026-09-27T12:00:00.000Z')
    expect(resetTimeOf('resets 12am (UTC)', '2026-09-27T08:00:00.000Z')).toBe('2026-09-28T00:00:00.000Z')
  })

  it('gives up on text without a reset time or with an unknown zone', () => {
    expect(resetTimeOf('API Error: 529 overloaded', '2026-09-27T14:39:02.453Z')).toBeNull()
    expect(resetTimeOf('resets 7pm (Mars/Olympus)', '2026-09-27T14:39:02.453Z')).toBeNull()
  })
})

describe('holdOf', () => {
  it('takes the reset time from the error text before the limits file', () => {
    expect(holdOf(session(), 'john@example.com', '2026-09-27T18:00:00.000Z')).toEqual(hold())
  })

  it('falls back to the limits file when the text has no reset time', () => {
    const limited = session({ limit: { at: '2026-09-27T14:39:02.453Z', text: 'rate limited' } })
    expect(holdOf(limited, null, '2026-09-27T18:00:00.000Z')).toMatchObject({ resetsAt: '2026-09-27T18:00:00.000Z', account: null })
  })

  it('expects a warm resume when the reset comes within the cache lifetime of the last reply', () => {
    const limited = session({ limit: { at: '2026-09-27T17:10:00.000Z', text: 'resets 7:20pm (Europe/Berlin)' }, lastReplyAt: '2026-09-27T17:05:00.000Z' })
    expect(holdOf(limited, 'john@example.com', null).then).toBe('resume')
  })
})

describe('relayStep', () => {
  it('waits until the limit resets', () => {
    expect(relayStep(hold(), new Date('2026-09-27T17:19:00Z'), ready)).toBe('wait')
  })

  it('hands the task to a new session when the cache has gone cold by the reset', () => {
    expect(relayStep(hold(), new Date('2026-09-27T17:20:00Z'), ready)).toBe('relay')
  })

  it('resumes the same session while its cache is still warm on the same account', () => {
    const warm = hold({ resetsAt: '2026-09-27T15:00:00.000Z' })
    expect(relayStep(warm, new Date('2026-09-27T15:00:30Z'), ready)).toBe('resume')
  })

  it('treats a cache as cold 55 minutes after the last reply', () => {
    const warm = hold({ resetsAt: '2026-09-27T15:00:00.000Z' })
    expect(relayStep(warm, new Date('2026-09-27T15:33:50Z'), ready)).toBe('relay')
  })

  it('hands over at once when the account was switched, even with a warm cache', () => {
    const other = { email: 'jane@example.com', ready: true }
    expect(relayStep(hold(), new Date('2026-09-27T14:45:00Z'), other)).toBe('relay')
  })

  it('waits while the account is signing in or signed out', () => {
    expect(relayStep(hold(), new Date('2026-09-27T18:00:00Z'), { email: 'jane@example.com', ready: false })).toBe('wait')
  })

  it('never resumes when the account at the limit is unknown', () => {
    const warm = hold({ account: null, resetsAt: '2026-09-27T15:00:00.000Z' })
    expect(relayStep(warm, new Date('2026-09-27T15:00:30Z'), ready)).toBe('relay')
  })

  it('waits only for an account switch when the reset time is unknown', () => {
    const unknown = hold({ resetsAt: null })
    expect(relayStep(unknown, new Date('2026-09-30T00:00:00Z'), ready)).toBe('wait')
    expect(relayStep(unknown, new Date('2026-09-30T00:00:00Z'), { email: 'jane@example.com', ready: true })).toBe('relay')
  })

  it('does nothing once the limit was acted on', () => {
    expect(relayStep(hold({ acted: 'relay' }), new Date('2026-09-27T18:00:00Z'), ready)).toBe('wait')
  })
})

describe('handoffPrompt', () => {
  it('starts with the task and points at the worktree, the branch and the old transcript', () => {
    const prompt = handoffPrompt('ABC-1', session({ recent: [line('Bash npm test'), line('Tests pass, writing the fix', 'text')] }))
    expect(prompt.split('\n')[0]).toBe('ABC-1')
    expect(prompt).toContain('D:/work/repo/.claude/worktrees/abc-1')
    expect(prompt).toContain('abc-1/some-work')
    expect(prompt).toContain('C:/claude/projects/repo/abc-session.jsonl')
    expect(prompt).toContain('Bash npm test')
    expect(prompt).toContain('Tests pass, writing the fix')
  })

  it('keeps the last ten steps and drops the error lines', () => {
    const recent = [...Array.from({ length: 12 }, (_, index) => line(`step ${index + 1}`)), line('You have hit your limit', 'error')]
    const prompt = handoffPrompt('ABC-1', session({ recent }))
    expect(prompt).not.toContain('step 2\n')
    expect(prompt).toContain('step 3')
    expect(prompt).toContain('step 12')
    expect(prompt).not.toContain('You have hit your limit')
  })

  it('leaves out the branch and the transcript when they are unknown', () => {
    const prompt = handoffPrompt('ABC-1', session({ branch: null, transcript: null }))
    expect(prompt).not.toContain('null')
  })
})
