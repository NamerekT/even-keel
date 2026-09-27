import { describe, expect, it } from 'vitest'
import type { LaunchEntry } from './dispatcher.js'
import { launchDays, taskSessions } from './launches.js'

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

describe('taskSessions', () => {
  const entry = (at: string, task: string, sessionId: string, extra: Partial<LaunchEntry> = {}): LaunchEntry => ({
    at,
    project: 'ABC',
    task,
    sessionId,
    ...extra,
  })

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
        { sessionId: 's3', at: '2026-09-27T17:20:00.000Z', how: 'relay', resumed: 0 },
        { sessionId: 's1', at: '2026-09-27T10:00:00.000Z', how: 'launch', resumed: 0 },
      ],
      'ABC-2': [{ sessionId: 's2', at: '2026-09-27T11:00:00.000Z', how: 'launch', resumed: 0 }],
    })
  })

  it('counts a warm resume on the session it continued instead of listing it twice', () => {
    const list = taskSessions(
      [entry('2026-09-27T10:00:00.000Z', 'ABC-1', 's1'), entry('2026-09-27T15:00:00.000Z', 'ABC-1', 's1', { reason: 'resume', previous: 's1' })],
      [],
    )
    expect(list['ABC-1']).toEqual([{ sessionId: 's1', at: '2026-09-27T10:00:00.000Z', how: 'launch', resumed: 1 }])
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
          left: { at: '2026-09-27T10:30:00.000Z', reason: 'postpone', blockers: ['ABC-3'] },
        },
      ],
      'ABC-2': [
        {
          sessionId: 's2',
          at: '2026-09-27T10:40:00.000Z',
          how: 'manual',
          resumed: 0,
          left: { at: '2026-09-27T11:00:00.000Z', reason: 'skip', blockers: [] },
        },
      ],
    })
  })
})
