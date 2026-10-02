import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../sessions/transcript.js'
import { CLEANUP_NOTE, handoffPrompt, holdOf, relayStep, startPrompt, type LimitHold, type LimitedSession } from './relay.js'

const line = (text: string, kind: FeedLine['kind'] = 'tool'): FeedLine => ({ at: '2026-09-27T14:38:00.000Z', kind, text })

const session = (overrides: Partial<LimitedSession> = {}): LimitedSession => ({
  sessionId: 'abc-session',
  agentId: 'abc',
  account: 'global',
  cwd: 'D:/work/repo',
  workdir: 'D:/work/repo/.claude/worktrees/abc-1',
  branch: 'abc-1/some-work',
  transcript: 'C:/claude/projects/repo/abc-session.jsonl',
  limit: { at: '2026-09-27T14:39:02.453Z', text: "You've hit your session limit · resets 7:20pm (Europe/Berlin)" },
  lastReplyAt: '2026-09-27T14:38:50.000Z',
  recent: [],
  lastMessage: null,
  checkpoint: null,
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

const ready = { id: 'john@example.com', ready: true }

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
    const other = { id: 'jane@example.com', ready: true }
    expect(relayStep(hold(), new Date('2026-09-27T14:45:00Z'), other)).toBe('relay')
  })

  it('waits while the account is signing in or signed out', () => {
    expect(relayStep(hold(), new Date('2026-09-27T18:00:00Z'), { id: 'jane@example.com', ready: false })).toBe('wait')
  })

  it('never resumes when the account at the limit is unknown', () => {
    const warm = hold({ account: null, resetsAt: '2026-09-27T15:00:00.000Z' })
    expect(relayStep(warm, new Date('2026-09-27T15:00:30Z'), ready)).toBe('relay')
  })

  it('waits only for an account switch when the reset time is unknown', () => {
    const unknown = hold({ resetsAt: null })
    expect(relayStep(unknown, new Date('2026-09-30T00:00:00Z'), ready)).toBe('wait')
    expect(relayStep(unknown, new Date('2026-09-30T00:00:00Z'), { id: 'jane@example.com', ready: true })).toBe('relay')
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

  it('passes the last message of the old session on whole', () => {
    const lastMessage = 'Done: the tests build.\n\nLeft:\n1. Run dotnet test.\n2. Fix the migration test.'
    expect(handoffPrompt('ABC-1', session({ lastMessage }))).toContain(lastMessage)
  })

  it('says the user stopped the old session when it is a restart rather than a limit', () => {
    const limit = handoffPrompt('ABC-1', session())
    const restart = handoffPrompt('ABC-1', session(), 'restart')
    expect(limit).toContain('лимит')
    expect(restart).not.toContain('лимит')
    expect(restart).toContain('пользователь')
  })

  it('says the old session checkpointed itself and points at its handoff note inside the worktree', () => {
    const prompt = handoffPrompt('ABC-1', session({ checkpoint: '.temp/handoff.md' }), 'checkpoint')
    expect(prompt).toContain('контрольную точку')
    expect(prompt).not.toContain('лимит')
    expect(prompt).toContain('D:/work/repo/.claude/worktrees/abc-1/.temp/handoff.md')
  })

  it('keeps an absolute handoff path as it is and mentions it on any handoff', () => {
    const prompt = handoffPrompt('ABC-1', session({ checkpoint: 'D:\\notes\\handoff.md' }))
    expect(prompt).toContain('лимит')
    expect(prompt).toContain('D:\\notes\\handoff.md')
    expect(prompt).not.toContain('worktrees/abc-1/D:')
  })

  it('says nothing of a handoff note when there is none', () => {
    expect(handoffPrompt('ABC-1', session())).not.toContain('handoff')
  })

  it('leaves the cleanup after the merge to Baton', () => {
    expect(handoffPrompt('ABC-1', session())).toContain(CLEANUP_NOTE)
  })

  it('fails instead of leaving a blank where the working folder or the branch should be', () => {
    expect(() => handoffPrompt('ABC-1', session({ workdir: '' }))).toThrow(/Рабочая папка/)
    expect(() => handoffPrompt('ABC-1', session({ branch: ' ' }))).toThrow(/Ветка/)
    expect(() => handoffPrompt('', session())).toThrow(/prompt/)
  })
})

describe('startPrompt', () => {
  it('starts with the task and points at the ready worktree and branch', () => {
    const prompt = startPrompt('ABC-1', { path: 'D:/work/repo/.claude/worktrees/abc-1', branch: 'abc-1/task' })
    expect(prompt.split('\n')[0]).toBe('ABC-1')
    expect(prompt).toContain('D:/work/repo/.claude/worktrees/abc-1')
    expect(prompt).toContain('новый worktree не создавай')
    expect(prompt).toContain('abc-1/task')
    expect(prompt).toContain(CLEANUP_NOTE)
  })

  it('leaves out the branch of a detached worktree', () => {
    expect(startPrompt('ABC-1', { path: 'D:/work/repo/.claude/worktrees/abc-1', branch: null })).not.toContain('null')
  })

  it('fails instead of leaving a blank where the worktree should be', () => {
    expect(() => startPrompt('ABC-1', { path: '', branch: 'abc-1/task' })).toThrow(/Worktree готов/)
  })
})
