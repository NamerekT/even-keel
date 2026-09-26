import { describe, expect, it } from 'vitest'
import type { LaunchEntry } from './dispatcher.js'
import { launchDays } from './launches.js'

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

  it('skips entries with an unreadable time', () => {
    const entries = [{ at: 'garbage', project: 'ABC', task: 'ABC-1', sessionId: 's' }]
    expect(launchDays(entries, now, 1)).toEqual([{ day: '2026-01-10', counts: {} }])
  })
})
