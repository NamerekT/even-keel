import { describe, expect, it } from 'vitest'
import { checkpointThreshold, DEFAULT_FIRST, type CheckpointMeasure } from './checkpoint.js'

const measured = (over: Partial<CheckpointMeasure> = {}): CheckpointMeasure => ({
  handoffs: 163,
  sessions: 400,
  base: 75_000,
  note: 0.24,
  recovery: 0.7,
  cacheRead: 0.2,
  ...over,
})

describe('checkpointThreshold', () => {
  it('is the default without statistics', () => {
    expect(checkpointThreshold('CBL', null, null)).toEqual({
      project: 'CBL',
      first: DEFAULT_FIRST,
      source: 'default',
      handoffs: 0,
      sessions: 0,
    })
  })

  it('is the base plus what a handoff costs in cache reads of the work left', () => {
    // 75k + $0.96 / (40 requests × $0.2 per million) = 195k
    expect(checkpointThreshold('CBL', measured({ recovery: 0.72 }), null)).toEqual({
      project: 'CBL',
      first: 195_000,
      source: 'calibrated',
      handoffs: 163,
      sessions: 400,
    })
  })

  it('stays the default until the project has enough handoffs and big sessions', () => {
    expect(checkpointThreshold('BTN', measured({ handoffs: 19 }), null)).toMatchObject({ first: DEFAULT_FIRST, source: 'default', handoffs: 19 })
    expect(checkpointThreshold('BTN', measured({ sessions: 49 }), null)).toMatchObject({ first: DEFAULT_FIRST, source: 'default', sessions: 49 })
    expect(checkpointThreshold('BTN', measured({ handoffs: 20, sessions: 50 }), null).source).toBe('calibrated')
  })

  it('keeps the calibrated threshold within 150–250k', () => {
    expect(checkpointThreshold('CBL', measured({ base: 40_000, recovery: 0.1, note: 0.05 }), null).first).toBe(150_000)
    expect(checkpointThreshold('CBL', measured({ recovery: 3 }), null).first).toBe(250_000)
  })

  it('stays the default when a measure is missing', () => {
    for (const hole of ['base', 'note', 'recovery', 'cacheRead'] as const) {
      expect(checkpointThreshold('CBL', measured({ [hole]: null }), null)).toMatchObject({ first: DEFAULT_FIRST, source: 'default' })
    }
    expect(checkpointThreshold('CBL', measured({ cacheRead: 0 }), null).source).toBe('default')
  })

  it('is the configured number whatever the statistics say', () => {
    expect(checkpointThreshold('CBL', measured(), 180_000)).toEqual({
      project: 'CBL',
      first: 180_000,
      source: 'config',
      handoffs: 163,
      sessions: 400,
    })
    expect(checkpointThreshold('CBL', null, 120_000)).toMatchObject({ first: 120_000, source: 'config' })
  })
})
