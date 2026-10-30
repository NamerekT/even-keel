import { describe, expect, it } from 'vitest'
import { taskCheckpoint } from './task-checkpoint.js'
import { withinWindow } from './checkpoint.js'

describe('task checkpoint threshold', () => {
  it('uses the current task labels while preserving the project threshold otherwise', () => {
    expect(taskCheckpoint(180_000, ['Break | compaction'])).toBe(999_999)
    expect(taskCheckpoint(null, ['Break | handoff'])).toBeNull()
    expect(taskCheckpoint(180_000, undefined)).toBe(180_000)
    expect(taskCheckpoint(180_000, ['Break | compaction', 'Break | handoff'])).toBe(180_000)
  })

  it('keeps the pinned task threshold beyond the window and disables late and hard caps', () => {
    const first = taskCheckpoint(180_000, ['Break | compaction'])!
    expect(withinWindow({ first, source: 'config' }, 250_000, { first: 72, late: 85, hard: 95 }, 'claude'))
      .toMatchObject({ first: 999_999, late: null, hard: null })
  })
})
