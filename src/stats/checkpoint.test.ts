import { describe, expect, it } from 'vitest'
import { checkpointThreshold, DEFAULT_FIRST, withinWindow, type CheckpointMeasure } from './checkpoint.js'

describe('withinWindow', () => {
  it('lowers a default or calibrated threshold to the share of the session window, marking it so', () => {
    expect(withinWindow({ first: DEFAULT_FIRST, source: 'default' }, 258_400)).toMatchObject({ first: 186_000, source: 'window' })
    expect(withinWindow({ first: 220_000, source: 'calibrated' }, 250_000)).toMatchObject({ first: 180_000, source: 'window' })
  })

  it('gives the late and hard thresholds as shares of the window, rounded down to 1k', () => {
    expect(withinWindow({ first: DEFAULT_FIRST, source: 'default' }, 258_400)).toEqual({ first: 186_000, source: 'window', late: 219_000, hard: 245_000 })
    expect(withinWindow({ first: 160_000, source: 'calibrated' }, 250_000)).toEqual({ first: 160_000, source: 'calibrated', late: 212_000, hard: 237_000 })
  })

  it('leaves a threshold under the share, one without a window, and one pinned in the settings alone', () => {
    expect(withinWindow({ first: 160_000, source: 'calibrated' }, 258_400)).toMatchObject({ first: 160_000, source: 'calibrated' })
    expect(withinWindow({ first: DEFAULT_FIRST, source: 'default' }, null)).toEqual({ first: DEFAULT_FIRST, source: 'default', late: null, hard: null })
    expect(withinWindow({ first: 999_999, source: 'config' }, 250_000)).toEqual({ first: 999_999, source: 'config', late: null, hard: null })
  })
})

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
