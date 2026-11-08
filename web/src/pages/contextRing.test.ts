import { describe, expect, it } from 'vitest'
import type { SessionCheckpoint } from '../../../src/stats/checkpoint.js'
import { checkpointMark, ringFacts } from './contextRing.js'

const scale = { window: 200_000, warn: 70, danger: 90 }

describe('ringFacts', () => {
  it('fills by the session’s own window and takes the scale’s thresholds', () => {
    expect(ringFacts(147_000, 285_000, scale, null)).toEqual({ tokens: 147_000, window: 285_000, percent: (147_000 / 285_000) * 100, level: 'ok', mark: null })
    expect(ringFacts(200_000, 250_000, scale, null).level).toBe('warn')
    expect(ringFacts(240_000, 250_000, scale, null).level).toBe('danger')
  })

  it('falls back to the setting’s window while the session gave none', () => {
    expect(ringFacts(100_000, null, scale, null)).toMatchObject({ window: 200_000, percent: 50 })
  })

  it('leaves the fill unknown without any window', () => {
    expect(ringFacts(52_000, null, null, 180_000)).toEqual({ tokens: 52_000, window: null, percent: null, level: 'ok', mark: null })
  })

  it('caps the fill at the full window', () => {
    expect(ringFacts(300_000, 250_000, scale, null).percent).toBe(100)
  })

  it('puts the checkpoint threshold on the bar as a share of the window', () => {
    expect(ringFacts(90_000, 250_000, scale, 180_000).mark).toBe(72)
  })

  it('drops a threshold past the window', () => {
    expect(ringFacts(90_000, 250_000, scale, 260_000).mark).toBeNull()
  })
})

describe('checkpointMark', () => {
  const found: SessionCheckpoint = { project: 'p', task: 'ABC-1', handoffs: 0, first: 180_000, source: 'calibrated', late: null, hard: null, context: null }

  it('is the first threshold the hook asks for a handoff at', () => {
    expect(checkpointMark(found)).toBe(180_000)
  })

  it('is none when the project turned handoffs off or the chain did not start the session', () => {
    expect(checkpointMark({ ...found, source: 'off' })).toBeNull()
    expect(checkpointMark(null)).toBeNull()
  })
})
