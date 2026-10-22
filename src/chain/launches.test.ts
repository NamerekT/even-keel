import { describe, expect, it } from 'vitest'
import type { LaunchEntry } from './dispatcher.js'
import { fallbacksSince, fixEpisodes, handoffsOf, launchDays, launchedProjects, ranSince, taskSessions } from './launches.js'

function launch(at: Date, project: string): LaunchEntry {
  return { at: at.toISOString(), project, task: `${project}-1`, sessionId: 's' }
}

describe('launchDays', () => {
  const now = new Date(2026, 0, 10, 15, 0)

  it('returns one entry per local day, oldest first, ending today', () => {
    const days = launchDays([], now, 3)
    expect(days).toEqual([
      { day: '2026-01-08', counts: {} },
      { day: '2026-01-09', counts: {} },
      { day: '2026-01-10', counts: {} },
    ])
  })

  it('counts launches per project on the local day they happened', () => {
    const entries = [
      launch(new Date(2026, 0, 9, 0, 5), 'ABC'),
      launch(new Date(2026, 0, 9, 23, 55), 'ABC'),
      launch(new Date(2026, 0, 9, 12, 0), 'XYZ'),
      launch(new Date(2026, 0, 10, 9, 0), 'XYZ'),
    ]
    expect(launchDays(entries, now, 2)).toEqual([
      { day: '2026-01-09', counts: { ABC: 2, XYZ: 1 } },
      { day: '2026-01-10', counts: { XYZ: 1 } },
    ])
  })

  it('leaves out launches older than the window and crosses month boundaries', () => {
    const entries = [launch(new Date(2025, 11, 31, 10, 0), 'ABC'), launch(new Date(2025, 11, 30, 10, 0), 'ABC')]
    expect(launchDays(entries, new Date(2026, 0, 1, 8, 0), 2)).toEqual([
      { day: '2025-12-31', counts: { ABC: 1 } },
      { day: '2026-01-01', counts: {} },
    ])
  })

  it('does not count the chain letting go of a task as a launch', () => {
    const at = new Date(2026, 0, 10, 9, 0).toISOString()
    const entries: LaunchEntry[] = [
      { at, project: 'ABC', task: 'ABC-1', sessionId: 's', reason: 'postpone', blockers: ['ABC-2'] },
      { at, project: 'ABC', task: 'ABC-1', sessionId: 's', reason: 'skip' },
    ]
    expect(launchDays(entries, now, 1)).toEqual([{ day: '2026-01-10', counts: {} }])
  })

  it('skips entries with an unreadable time', () => {
    const entries = [{ at: 'garbage', project: 'ABC', task: 'ABC-1', sessionId: 's' }]
    expect(launchDays(entries, now, 1)).toEqual([{ day: '2026-01-10', counts: {} }])
  })
})

const entry = (at: string, task: string, sessionId: string, extra: Partial<LaunchEntry> = {}): LaunchEntry => ({
  at,
  project: 'ABC',
  task,
  sessionId,
  ...extra,
})

describe('taskSessions', () => {

  it('lists the sessions of each task newest first with how they were started', () => {
    const list = taskSessions(
      [
        entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'),
        entry('2026-09-27T11:00:00.000Z', 'ABC-2', 's2'),
        entry('2026-09-27T17:20:00.000Z', 'ABC-1', 's3', { reason: 'relay', previous: 's1' }),
      ],
      [],
    )
    expect(list).toEqual({
      'ABC-1': [
        { sessionId: 's3', at: '2026-09-27T17:20:00.000Z', how: 'relay', resumed: 0, answers: 0 },
        { sessionId: 's1', at: '2026-09-27T10:00:00.000Z', how: 'launch', resumed: 0, answers: 0, replaced: { at: '2026-09-27T17:20:00.000Z', how: 'relay' } },
      ],
      'ABC-2': [{ sessionId: 's2', at: '2026-09-27T11:00:00.000Z', how: 'launch', resumed: 0, answers: 0 }],
    })
  })

  it('carries the cause of a new session with a handoff to its row and to the row it replaced', () => {
    const list = taskSessions(
      [
        entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'),
        entry('2026-09-27T11:00:00.000Z', 'ABC-1', 's2', { reason: 'relay', cause: 'returned', previous: 's1' }),
        entry('2026-09-27T12:00:00.000Z', 'ABC-1', 's3', { reason: 'review', cause: 'review', previous: 's2' }),
        entry('2026-09-27T13:00:00.000Z', 'ABC-1', 's4', { reason: 'relay', cause: 'mainFixed', previous: 's3' }),
      ],
      [],
    )['ABC-1']!
    expect(list.map((row) => [row.sessionId, row.how, row.cause, row.replaced?.cause])).toEqual([
      ['s4', 'relay', 'mainFixed', undefined],
      ['s3', 'relay', 'review', 'mainFixed'],
      ['s2', 'relay', 'returned', 'review'],
      ['s1', 'launch', undefined, 'returned'],
    ])
  })

  it('leaves the cause of an older relay entry unset and a review of the same session a plain launch', () => {
    const list = taskSessions(
      [
        entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1', { reason: 'review' }),
        entry('2026-09-27T11:00:00.000Z', 'ABC-1', 's2', { reason: 'relay', previous: 's1' }),
      ],
      [],
    )['ABC-1']!
    expect(list.map((row) => [row.sessionId, row.how, row.cause])).toEqual([
      ['s2', 'relay', undefined],
      ['s1', 'launch', undefined],
    ])
  })

  it('counts a warm resume on the session it continued instead of listing it twice', () => {
    const list = taskSessions(
      [entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'), entry('2026-09-27T15:00:00.000Z', 'ABC-1', 's1', { reason: 'resume', previous: 's1' })],
      [],
    )
    expect(list['ABC-1']).toEqual([{ sessionId: 's1', at: '2026-09-27T10:00:00.000Z', how: 'launch', resumed: 1, answers: 0 }])
  })

  it('counts the user\'s answers to a session apart from resumes after the limit', () => {
    const list = taskSessions(
      [
        entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'),
        entry('2026-09-27T11:00:00.000Z', 'ABC-1', 's1', { reason: 'answer', previous: 's1' }),
        entry('2026-09-27T12:00:00.000Z', 'ABC-1', 's1', { reason: 'answer', previous: 's1' }),
      ],
      [],
    )
    expect(list['ABC-1']).toEqual([
      { sessionId: 's1', at: '2026-09-27T10:00:00.000Z', how: 'launch', resumed: 0, answers: 2, answeredAt: '2026-09-27T12:00:00.000Z' },
    ])
  })

  it('names the account of each session as of its start', () => {
    const list = taskSessions(
      [entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'), entry('2026-09-27T11:00:00.000Z', 'ABC-1', 's2')],
      [{ task: 'ABC-1', sessionId: 's9', startedAt: '2026-09-27T12:00:00.000Z' }],
      (sessionId, at) => (sessionId === 's2' ? null : `${sessionId}@example.com ${at}`),
    )
    expect(list['ABC-1']?.map((row) => [row.sessionId, row.account])).toEqual([
      ['s9', 's9@example.com 2026-09-27T12:00:00.000Z'],
      ['s2', null],
      ['s1', 's1@example.com 2026-09-27T10:00:00.000Z'],
    ])
  })

  it('adds a session started by hand that the journal does not know', () => {
    const list = taskSessions([entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1')], [
      { task: 'ABC-1', sessionId: 's9', startedAt: '2026-09-27T12:00:00.000Z' },
      { task: 'ABC-1', sessionId: 's1', startedAt: '2026-09-27T10:00:01.000Z' },
    ])
    expect(list['ABC-1']?.map((row) => [row.sessionId, row.how])).toEqual([
      ['s9', 'manual'],
      ['s1', 'launch'],
    ])
  })

  it('marks the session the chain let go of and why', () => {
    const list = taskSessions(
      [
        entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'),
        entry('2026-09-27T10:30:00.000Z', 'ABC-1', 's1', { reason: 'postpone', blockers: ['ABC-3'] }),
        entry('2026-09-27T11:00:00.000Z', 'ABC-2', 's2', { reason: 'skip' }),
      ],
      [{ task: 'ABC-2', sessionId: 's2', startedAt: '2026-09-27T10:40:00.000Z' }],
    )
    expect(list).toEqual({
      'ABC-1': [
        {
          sessionId: 's1',
          at: '2026-09-27T10:00:00.000Z',
          how: 'launch',
          resumed: 0,
          answers: 0,
          left: { at: '2026-09-27T10:30:00.000Z', reason: 'postpone', blockers: ['ABC-3'] },
        },
      ],
      'ABC-2': [
        {
          sessionId: 's2',
          at: '2026-09-27T10:40:00.000Z',
          how: 'manual',
          resumed: 0,
          answers: 0,
          left: { at: '2026-09-27T11:00:00.000Z', reason: 'skip', blockers: [] },
        },
      ],
    })
  })

  it('lists a restart and marks the session it replaced', () => {
    const list = taskSessions(
      [
        entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'),
        entry('2026-09-27T12:00:00.000Z', 'ABC-1', 's2', { reason: 'restart', previous: 's1' }),
      ],
      [],
    )
    expect(list['ABC-1']).toEqual([
      { sessionId: 's2', at: '2026-09-27T12:00:00.000Z', how: 'restart', resumed: 0, answers: 0 },
      { sessionId: 's1', at: '2026-09-27T10:00:00.000Z', how: 'launch', resumed: 0, answers: 0, replaced: { at: '2026-09-27T12:00:00.000Z', how: 'restart' } },
    ])
  })

  it('lists checkpoint handoffs one after another and marks each session that checkpointed', () => {
    const list = taskSessions(
      [
        entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'),
        entry('2026-09-27T11:00:00.000Z', 'ABC-1', 's2', { reason: 'checkpoint', previous: 's1' }),
        entry('2026-09-27T12:00:00.000Z', 'ABC-1', 's3', { reason: 'checkpoint', previous: 's2' }),
      ],
      [],
    )
    expect(list['ABC-1']).toEqual([
      { sessionId: 's3', at: '2026-09-27T12:00:00.000Z', how: 'checkpoint', resumed: 0, answers: 0 },
      { sessionId: 's2', at: '2026-09-27T11:00:00.000Z', how: 'checkpoint', resumed: 0, answers: 0, replaced: { at: '2026-09-27T12:00:00.000Z', how: 'checkpoint' } },
      { sessionId: 's1', at: '2026-09-27T10:00:00.000Z', how: 'launch', resumed: 0, answers: 0, replaced: { at: '2026-09-27T11:00:00.000Z', how: 'checkpoint' } },
    ])
  })
})

describe('handoffsOf', () => {
  const journal = [
    entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'),
    entry('2026-09-27T10:30:00.000Z', 'ABC-2', 'other', { reason: 'checkpoint', previous: 'gone' }),
    entry('2026-09-27T11:00:00.000Z', 'ABC-1', 's2', { reason: 'checkpoint', previous: 's1' }),
    entry('2026-09-27T11:30:00.000Z', 'ABC-1', 's2', { reason: 'resume' }),
    entry('2026-09-27T12:00:00.000Z', 'ABC-1', 's3', { reason: 'relay', previous: 's2' }),
    entry('2026-09-27T12:30:00.000Z', 'ABC-1', 's3', { reason: 'postpone' }),
    entry('2026-09-27T13:00:00.000Z', 'ABC-1', 's4'),
    entry('2026-09-27T14:00:00.000Z', 'ABC-1', 's5', { reason: 'restart', previous: 's4' }),
  ]

  it('counts the handoffs of the task up to the session, whatever started them', () => {
    expect(handoffsOf(journal, 's1')).toEqual({ project: 'ABC', task: 'ABC-1', handoffs: 0 })
    expect(handoffsOf(journal, 's2')).toEqual({ project: 'ABC', task: 'ABC-1', handoffs: 1 })
    expect(handoffsOf(journal, 's3')).toEqual({ project: 'ABC', task: 'ABC-1', handoffs: 2 })
    expect(handoffsOf(journal, 's5')).toEqual({ project: 'ABC', task: 'ABC-1', handoffs: 3 })
  })

  it('does not count a session the chain started anew, nor a warm resume', () => {
    expect(handoffsOf(journal, 's4')).toEqual({ project: 'ABC', task: 'ABC-1', handoffs: 2 })
  })

  it('knows nothing about a session the chain did not start', () => {
    expect(handoffsOf(journal, 'manual')).toBeUndefined()
  })
})

describe('ranSince', () => {
  const entry = (at: string, task: string, reason?: LaunchEntry['reason']): LaunchEntry => ({
    at,
    project: task.replace(/-\d+$/, ''),
    task,
    sessionId: `${task}-${at}`,
    ...(reason ? { reason } : {}),
  })
  const since = new Date('2026-01-10T00:00:00Z')

  it('lists the tasks of the project the chain started since then, each once, in launch order', () => {
    const entries = [
      entry('2026-01-10T01:00:00Z', 'ABC-2'),
      entry('2026-01-10T02:00:00Z', 'XYZ-1'),
      entry('2026-01-10T03:00:00Z', 'ABC-1'),
      entry('2026-01-10T04:00:00Z', 'ABC-2', 'checkpoint'),
    ]
    expect(ranSince(entries, 'ABC', since)).toEqual(['ABC-2', 'ABC-1'])
  })

  it('leaves out older launches and the releases, which start nothing', () => {
    const entries = [
      entry('2026-01-09T23:59:00Z', 'ABC-1'),
      entry('2026-01-10T01:00:00Z', 'ABC-2', 'postpone'),
      entry('2026-01-10T01:00:00Z', 'ABC-3', 'skip'),
      entry('not a date', 'ABC-4'),
    ]
    expect(ranSince(entries, 'ABC', since)).toEqual([])
  })

  it('leaves out the fix session of main, which is not a task', () => {
    const fix: LaunchEntry = { at: '2026-01-10T02:00:00Z', project: 'ABC', task: 'ABC-FIX', sessionId: 'fix' }
    expect(ranSince([entry('2026-01-10T01:00:00Z', 'ABC-2'), fix], 'ABC', since)).toEqual(['ABC-2'])
  })
})

describe('launchedProjects', () => {
  const entry = (project: string, task: string, reason?: LaunchEntry['reason']): LaunchEntry => ({
    at: '2026-01-10T01:00:00Z',
    project,
    task,
    sessionId: task,
    ...(reason ? { reason } : {}),
  })

  it('names each project the chain started a task of, once', () => {
    expect(launchedProjects([entry('ABC', 'ABC-1'), entry('XYZ', 'XYZ-3'), entry('ABC', 'ABC-2')])).toEqual(['ABC', 'XYZ'])
  })

  it('does not count releases or the fix session of main, which start no task of the tracker', () => {
    expect(launchedProjects([entry('ABC', 'ABC-1', 'skip'), entry('XYZ', 'XYZ-FIX'), entry('OPS', 'OPS-1', 'postpone')])).toEqual([])
  })
})

describe('fallbacksSince', () => {
  const entry = (task: string, at: string, fallback?: string): LaunchEntry => ({ at, project: 'ABC', task, sessionId: task, ...(fallback ? { fallback } : {}) })

  it('keeps the launches since the moment that ran on the project provider instead of the label, newest first', () => {
    const entries = [
      entry('ABC-1', '2026-01-09T10:00:00Z', 'codex'),
      entry('ABC-2', '2026-01-10T01:00:00Z', 'codex'),
      entry('ABC-3', '2026-01-10T02:00:00Z'),
      entry('ABC-4', '2026-01-10T03:00:00Z', 'codex'),
    ]
    expect(fallbacksSince(entries, new Date('2026-01-10T00:00:00Z')).map((each) => each.task)).toEqual(['ABC-4', 'ABC-2'])
  })
})

describe('fixEpisodes', () => {
  const fix = (at: string, sessionId: string, extra: Partial<LaunchEntry> = {}) => entry(at, 'ABC-FIX', sessionId, extra)

  it('makes each fix an episode of its own, from its launch to its outcome', () => {
    const { episodes } = fixEpisodes([
      fix('2026-10-16T06:30:00.000Z', 'f1', { commit: 'red1' }),
      entry('2026-10-16T06:40:00.000Z', 'ABC-2', 's2'),
      fix('2026-10-16T06:50:00.000Z', 'f2', { reason: 'checkpoint', previous: 'f1' }),
      fix('2026-10-16T07:00:00.000Z', 'f2', { reason: 'landed', commit: 'green1' }),
      fix('2026-10-16T09:00:00.000Z', 'f3', { commit: 'red2' }),
      fix('2026-10-16T09:10:00.000Z', 'f3', { reason: 'dropped' }),
      fix('2026-10-16T10:00:00.000Z', 'f4', { commit: 'red3' }),
    ])
    expect(episodes).toEqual({
      ABC: [
        { id: 'ABC-FIX.1', red: 'red1', at: '2026-10-16T06:30:00.000Z', end: { at: '2026-10-16T07:00:00.000Z', how: 'landed', commit: 'green1' } },
        { id: 'ABC-FIX.2', red: 'red2', at: '2026-10-16T09:00:00.000Z', end: { at: '2026-10-16T09:10:00.000Z', how: 'dropped', commit: null } },
        { id: 'ABC-FIX.3', red: 'red3', at: '2026-10-16T10:00:00.000Z', end: null },
      ],
    })
  })

  it('keeps a launch of the same red commit in the open episode', () => {
    const { episodes } = fixEpisodes([fix('2026-10-16T06:30:00.000Z', 'f1', { commit: 'red1' }), fix('2026-10-16T06:45:00.000Z', 'f2', { commit: 'red1' })])
    expect(episodes.ABC).toEqual([{ id: 'ABC-FIX.1', red: 'red1', at: '2026-10-16T06:30:00.000Z', end: null }])
  })

  it('closes an episode left without an outcome as lost once another fix starts', () => {
    const { episodes } = fixEpisodes([fix('2026-10-01T06:30:00.000Z', 'old'), fix('2026-10-16T06:30:00.000Z', 'f1', { commit: 'red1' })])
    expect(episodes.ABC).toEqual([
      { id: 'ABC-FIX.1', red: null, at: '2026-10-01T06:30:00.000Z', end: { at: '2026-10-16T06:30:00.000Z', how: 'lost', commit: null } },
      { id: 'ABC-FIX.2', red: 'red1', at: '2026-10-16T06:30:00.000Z', end: null },
    ])
  })
})

describe('taskSessions of the fix of main', () => {
  it('lists the sessions of each episode under its id, a live one by hand under the open episode', () => {
    const list = taskSessions(
      [
        entry('2026-10-16T06:30:00.000Z', 'ABC-FIX', 'f1', { commit: 'red1' }),
        entry('2026-10-16T06:50:00.000Z', 'ABC-FIX', 'f2', { reason: 'checkpoint', previous: 'f1' }),
        entry('2026-10-16T06:55:00.000Z', 'ABC-FIX', 'f2', { reason: 'answer', previous: 'f2' }),
        entry('2026-10-16T07:00:00.000Z', 'ABC-FIX', 'f2', { reason: 'landed', commit: 'green1' }),
        entry('2026-10-16T09:00:00.000Z', 'ABC-FIX', 'f3', { commit: 'red2' }),
      ],
      [{ task: 'ABC-FIX', sessionId: 'f9', startedAt: '2026-10-16T09:30:00.000Z' }],
    )
    expect(list).toEqual({
      'ABC-FIX.1': [
        { sessionId: 'f2', at: '2026-10-16T06:50:00.000Z', how: 'checkpoint', resumed: 0, answers: 1, answeredAt: '2026-10-16T06:55:00.000Z' },
        { sessionId: 'f1', at: '2026-10-16T06:30:00.000Z', how: 'launch', resumed: 0, answers: 0, replaced: { at: '2026-10-16T06:50:00.000Z', how: 'checkpoint' } },
      ],
      'ABC-FIX.2': [
        { sessionId: 'f9', at: '2026-10-16T09:30:00.000Z', how: 'manual', resumed: 0, answers: 0 },
        { sessionId: 'f3', at: '2026-10-16T09:00:00.000Z', how: 'launch', resumed: 0, answers: 0 },
      ],
    })
  })

  it('puts a live fix session the journal does not know into the next episode when none is open', () => {
    const list = taskSessions(
      [entry('2026-10-16T06:30:00.000Z', 'ABC-FIX', 'f1', { commit: 'red1' }), entry('2026-10-16T07:00:00.000Z', 'ABC-FIX', 'f1', { reason: 'dropped' })],
      [{ task: 'ABC-FIX', sessionId: 'f9', startedAt: '2026-10-16T09:30:00.000Z' }],
    )
    expect(Object.keys(list)).toEqual(['ABC-FIX.1', 'ABC-FIX.2'])
  })

  it('does not count the outcome of a fix as a launch nor a handoff', () => {
    const journal = [
      entry('2026-10-16T06:30:00.000Z', 'ABC-FIX', 'f1', { commit: 'red1' }),
      entry('2026-10-16T07:00:00.000Z', 'ABC-FIX', 'f1', { reason: 'landed', commit: 'green1' }),
    ]
    expect(launchDays(journal, new Date('2026-10-16T12:00:00.000Z'), 1)[0]?.counts).toEqual({ ABC: 1 })
    expect(handoffsOf(journal, 'f1')).toEqual({ project: 'ABC', task: 'ABC-FIX', handoffs: 0 })
  })
})
