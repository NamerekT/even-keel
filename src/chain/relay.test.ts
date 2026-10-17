import { describe, expect, it } from 'vitest'
import type { TaskPlace } from '../git/types.js'
import type { FeedLine } from '../sessions/transcript.js'
import type { TaskBrief } from '../tracker/source.js'
import { PROMPTS } from './prompts.js'
import {
  fixPrompt,
  handoffPrompt,
  holdOf,
  mainFixedPrompt,
  relayStep,
  resumePrompt,
  startPrompt,
  warmCacheMs,
  withBrief,
  withProjectPrompt,
  withReport,
  withReset,
  withTracker,
  withUnattended,
  type HandoffReason,
  type HandoffSession,
  type LimitHold,
  type LimitedSession,
} from './relay.js'

const CLEANUP_NOTE = PROMPTS.ru.cleanup('main')
const handoff = (task: string, from: HandoffSession, reason: HandoffReason = 'limit') => handoffPrompt(task, from, reason, 'ru')
const start = (task: string, place: TaskPlace) => startPrompt(task, place, 'ru')
const brief = (prompt: string, task: TaskBrief | undefined) => withBrief(prompt, task, 'ru')

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

  it('plans by the session’s own cache lifetime when it has one', () => {
    const empty = session({ limit: { at: '2026-09-27T14:39:02.453Z', text: 'Credit balance is too low' }, warmMs: warmCacheMs('5m') })
    expect(holdOf(empty, 'api-key', null)).toMatchObject({ resetsAt: null, then: 'relay' })
    expect(holdOf(empty, 'api-key', '2026-09-27T14:40:00.000Z').then).toBe('resume')
    expect(holdOf(empty, 'api-key', '2026-09-27T14:50:00.000Z').then).toBe('relay')
  })
})

describe('withReset', () => {
  it('fills in a reset time learned after the limit and plans the step for it', () => {
    const unknown = hold({ resetsAt: null, lastReplyAt: '2026-09-27T14:38:50.000Z' })
    expect(withReset(unknown, '2026-09-27T15:00:00.000Z')).toEqual(hold({ resetsAt: '2026-09-27T15:00:00.000Z', then: 'resume' }))
    expect(withReset(unknown, '2026-09-27T17:20:00.000Z')).toEqual(hold())
  })

  it('plans a handover when the reset comes after a shorter cache lifetime', () => {
    const unknown = hold({ resetsAt: null, lastReplyAt: '2026-09-27T14:38:50.000Z' })
    expect(withReset(unknown, '2026-09-27T14:41:00.000Z', warmCacheMs('5m')).then).toBe('resume')
    expect(withReset(unknown, '2026-09-27T14:45:00.000Z', warmCacheMs('5m')).then).toBe('relay')
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

  it('takes the cache lifetime of the session when it is shorter, as on an API key', () => {
    const credit = hold({ resetsAt: '2026-09-27T14:40:00.000Z' })
    expect(relayStep(credit, new Date('2026-09-27T14:42:00Z'), ready, warmCacheMs('5m'))).toBe('resume')
    expect(relayStep(credit, new Date('2026-09-27T14:43:00Z'), ready, warmCacheMs('5m'))).toBe('relay')
    expect(relayStep(credit, new Date('2026-09-27T15:30:00Z'), ready, warmCacheMs('1h'))).toBe('resume')
  })

  it('does nothing once the limit was acted on', () => {
    expect(relayStep(hold({ acted: 'relay' }), new Date('2026-09-27T18:00:00Z'), ready)).toBe('wait')
  })
})

describe('handoffPrompt', () => {
  it('starts with the task and points at the worktree, the branch and the old transcript', () => {
    const prompt = handoff('ABC-1', session({ recent: [line('Bash npm test'), line('Tests pass, writing the fix', 'text')] }))
    expect(prompt.split('\n')[0]).toBe('ABC-1')
    expect(prompt).toContain('D:/work/repo/.claude/worktrees/abc-1')
    expect(prompt).toContain('abc-1/some-work')
    expect(prompt).toContain('C:/claude/projects/repo/abc-session.jsonl')
    expect(prompt).toContain('Bash npm test')
    expect(prompt).toContain('Tests pass, writing the fix')
  })

  it('leaves prompts of the old session out of its last steps', () => {
    const prompt = handoff('ABC-1', session({ recent: [line('ABC-1 Continue the task', 'prompt'), line('Bash npm test')] }))
    expect(prompt).not.toContain('Continue the task')
  })

  it('keeps the last ten steps and drops the error lines', () => {
    const recent = [...Array.from({ length: 12 }, (_, index) => line(`step ${index + 1}`)), line('You have hit your limit', 'error')]
    const prompt = handoff('ABC-1', session({ recent }))
    expect(prompt).not.toContain('step 2\n')
    expect(prompt).toContain('step 3')
    expect(prompt).toContain('step 12')
    expect(prompt).not.toContain('You have hit your limit')
  })

  it('leaves out the branch and the transcript when they are unknown', () => {
    const prompt = handoff('ABC-1', session({ branch: null, transcript: null }))
    expect(prompt).not.toContain('null')
  })

  it('passes the last message of the old session on whole', () => {
    const lastMessage = 'Done: the tests build.\n\nLeft:\n1. Run dotnet test.\n2. Fix the migration test.'
    expect(handoff('ABC-1', session({ lastMessage }))).toContain(lastMessage)
  })

  it('says the user stopped the old session when it is a restart rather than a limit', () => {
    const limit = handoff('ABC-1', session())
    const restart = handoff('ABC-1', session(), 'restart')
    expect(limit).toContain('лимит')
    expect(restart).not.toContain('лимит')
    expect(restart).toContain('пользователь')
  })

  it('says the old session checkpointed itself and points at its handoff note inside the worktree', () => {
    const prompt = handoff('ABC-1', session({ checkpoint: '.temp/handoff.md' }), 'checkpoint')
    expect(prompt).toContain('контрольную точку')
    expect(prompt).not.toContain('лимит')
    expect(prompt).toContain('D:/work/repo/.claude/worktrees/abc-1/.temp/handoff.md')
  })

  it('keeps an absolute handoff path as it is and mentions it on any handoff', () => {
    const prompt = handoff('ABC-1', session({ checkpoint: 'D:\\notes\\handoff.md' }))
    expect(prompt).toContain('лимит')
    expect(prompt).toContain('D:\\notes\\handoff.md')
    expect(prompt).not.toContain('worktrees/abc-1/D:')
  })

  it('leaves the last steps and the last message to the handoff note when there is one', () => {
    const recent = [line('Bash npm test'), line('Checkpoint is written', 'text')]
    const lastMessage = 'Checkpoint is written.\n\nCHECKPOINT: .temp/handoff.md'
    for (const reason of ['checkpoint', 'limit'] as const) {
      const prompt = handoff('ABC-1', session({ recent, lastMessage, checkpoint: '.temp/handoff.md' }), reason)
      expect(prompt).toContain('.temp/handoff.md')
      expect(prompt).not.toContain('Bash npm test')
      expect(prompt).not.toContain('Checkpoint is written')
    }
  })

  it('says nothing of a handoff note when there is none', () => {
    expect(handoff('ABC-1', session())).not.toContain('handoff')
  })

  it('leaves the cleanup after the merge to Even Keel', () => {
    expect(handoff('ABC-1', session())).toContain(CLEANUP_NOTE)
  })

  it('fails instead of leaving a blank where the working folder or the branch should be', () => {
    expect(() => handoff('ABC-1', session({ workdir: '' }))).toThrow(/Рабочая папка/)
    expect(() => handoff('ABC-1', session({ branch: ' ' }))).toThrow(/Ветка/)
    expect(() => handoff('', session())).toThrow(/prompt/)
  })
})

describe('startPrompt', () => {
  it('starts with the task and points at the ready worktree and branch', () => {
    const prompt = start('ABC-1', { path: 'D:/work/repo/.claude/worktrees/abc-1', branch: 'abc-1/task' })
    expect(prompt.split('\n')[0]).toBe('ABC-1')
    expect(prompt).toContain('D:/work/repo/.claude/worktrees/abc-1')
    expect(prompt).toContain('новый worktree не создавай')
    expect(prompt).toContain('abc-1/task')
    expect(prompt).toContain(CLEANUP_NOTE)
  })

  it('leaves out the branch of a detached worktree', () => {
    expect(start('ABC-1', { path: 'D:/work/repo/.claude/worktrees/abc-1', branch: null })).not.toContain('null')
  })

  it('fails instead of leaving a blank where the worktree should be', () => {
    expect(() => start('ABC-1', { path: '', branch: 'abc-1/task' })).toThrow(/Worktree готов/)
  })
})

describe('withBrief', () => {
  const prompt = 'ABC-1\n\n- Ветка: abc-1/task — не меняй её.\n'

  it('appends the title and the description of the task to the prompt', () => {
    const text = brief(prompt, { title: 'Add a button', description: 'The button **saves** the form.\n' })
    expect(text.startsWith(prompt)).toBe(true)
    expect(text.slice(prompt.length)).toBe('\nЗадача из трекера: Add a button\n\nThe button **saves** the form.\n')
  })

  it('leaves out an empty description and keeps the prompt as it is without a brief', () => {
    expect(brief(prompt, { title: 'Add a button', description: ' \n' })).toBe(`${prompt}\nЗадача из трекера: Add a button\n`)
    expect(brief(prompt, undefined)).toBe(prompt)
  })

  it('fails on a task without a title', () => {
    expect(() => brief(prompt, { title: ' ', description: 'Text' })).toThrow(/Задача из трекера/)
  })
})

describe('withReport', () => {
  it('appends the trimmed report to the prompt', () => {
    expect(withReport('ABC-FIX', 'prompt', '  broke  \n')).toBe('prompt\nbroke\n')
  })

  it('fails with a code when there is no report', () => {
    for (const report of [undefined, ' \n']) {
      expect(() => withReport('ABC-FIX', 'prompt', report)).toThrowError(expect.objectContaining({ notice: { code: 'chain.fixReportMissing', params: { task: 'ABC-FIX' } } }))
    }
  })
})

describe('withProjectPrompt', () => {
  const prompt = 'ABC-1\n\n- Ветка: abc-1/task — не меняй её.\n'

  it('appends the project prompt under its heading', () => {
    expect(withProjectPrompt(prompt, 'Run npm test before merging.', 'ru')).toBe(
      `${prompt}\nУказания для этого проекта:\nRun npm test before merging.\n`,
    )
    expect(withProjectPrompt(prompt, 'Mind Library.', 'en')).toBe(`${prompt}\nInstructions for this project:\nMind Library.\n`)
  })

  it('keeps the prompt as it is without a project prompt', () => {
    expect(withProjectPrompt(prompt, null, 'ru')).toBe(prompt)
  })
})

describe('withUnattended', () => {
  const prompt = 'ABC-1\n\n- Ветка: abc-1/task — не меняй её.\n'

  it('appends the unattended rules in the prompt language when the mode is on', () => {
    expect(withUnattended(prompt, true, 'ru')).toBe(`${prompt}\n${PROMPTS.ru.unattended}\n`)
    expect(withUnattended(prompt, true, 'en')).toContain(PROMPTS.en.unattended)
  })

  it('keeps the prompt as it is when the mode is off', () => {
    expect(withUnattended(prompt, false, 'ru')).toBe(prompt)
  })

  it('tells the session to park the task instead of asking', () => {
    for (const language of ['ru', 'en'] as const) {
      const text = PROMPTS[language].unattended
      expect(text).toMatch(/AskUserQuestion/)
      expect(text).toMatch(/Backlog/)
      expect(text).toMatch(/git status/)
    }
  })
})

describe('prompts in English', () => {
  const place = { path: 'D:/work/repo/.claude/worktrees/abc-1', branch: 'abc-1/task' }

  it('builds the start prompt with the same parts', () => {
    const prompt = startPrompt('ABC-1', place, 'en')
    expect(prompt).toBe(
      [
        'ABC-1',
        '',
        '- Worktree is ready: D:/work/repo/.claude/worktrees/abc-1 — work in it, do not create a new worktree.',
        '- Branch: abc-1/task — do not change it.',
        PROMPTS.en.cleanup('main'),
        '',
      ].join('\n'),
    )
  })

  it('names the project’s main branch when it is not main', () => {
    expect(startPrompt('ABC-1', place, 'en', 'master')).toContain('Merging the branch into master of the main checkout closes the task.')
    const prompt = handoffPrompt('ABC-1', session(), 'limit', 'ru', 'master')
    expect(prompt).toContain('git log master..HEAD')
    expect(prompt).not.toMatch(/\bmain\.\.HEAD|в main\b/)
    expect(fixPrompt('Broken.', place, 'en', 'trunk')).toContain('Merge the fix into trunk of the main checkout')
    expect(mainFixedPrompt('c1c1c1c1c1', 'c2c2c2c2c2', 'en', 'trunk')).toContain('Merge trunk into your branch')
  })

  it('builds the handoff prompt for each reason without a Russian word', () => {
    const recent = [line('Bash npm test')]
    for (const reason of ['limit', 'restart', 'checkpoint'] as const) {
      const prompt = handoffPrompt('ABC-1', session({ recent, lastMessage: 'Done.' }), reason, 'en')
      expect(prompt).toContain(PROMPTS.en.why[reason])
      expect(prompt).toContain('- Working folder: D:/work/repo/.claude/worktrees/abc-1')
      expect(prompt).toContain('Last steps of the previous session:')
      expect(prompt).not.toMatch(/[а-яё]/i)
    }
  })

  it('appends the brief and gives the resume prompt in English', () => {
    expect(withBrief('ABC-1\n', { title: 'Add a button', description: '' }, 'en')).toBe('ABC-1\n\nTask from the tracker: Add a button\n')
    expect(resumePrompt('en')).not.toMatch(/[а-яё]/i)
    expect(resumePrompt('ru')).toBe('Лимит сброшен — продолжай с того же места.')
  })

  it('names the project in the tracker, so a session finds its task without a matching remote', () => {
    expect(withTracker('ABC-1\n', { title: 'GitHub', project: 'octo-org/abc' }, 'en')).toBe('ABC-1\n\nTracker: GitHub, project octo-org/abc.\n')
    expect(withTracker('ABC-1\n', { title: 'GitHub', project: 'octo-org/abc' }, 'ru')).toBe('ABC-1\n\nТрекер: GitHub, проект octo-org/abc.\n')
    expect(withTracker('ABC-1\n', null, 'en')).toBe('ABC-1\n')
  })

  it('has every prompt in every language', () => {
    expect(Object.keys(PROMPTS.en).sort()).toEqual(Object.keys(PROMPTS.ru).sort())
  })
})
