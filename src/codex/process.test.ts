import { describe, expect, it } from 'vitest'
import { APPEAR_TIMEOUT_MS, processBelongsToTurn, turnStartedAt } from './process.js'

describe('processBelongsToTurn', () => {
  const turnAt = 1_790_000_000_000

  it('rejects a reused pid whose process started after the launch window', () => {
    expect(processBelongsToTurn(turnAt + APPEAR_TIMEOUT_MS + 1, turnAt)).toBe(false)
  })

  it('accepts processes up to and including the launch deadline', () => {
    expect(processBelongsToTurn(turnAt - 1, turnAt)).toBe(true)
    expect(processBelongsToTurn(turnAt, turnAt)).toBe(true)
    expect(processBelongsToTurn(turnAt + APPEAR_TIMEOUT_MS, turnAt)).toBe(true)
  })

  it('preserves the stop behaviour when either time is unknown', () => {
    expect(processBelongsToTurn(undefined, turnAt)).toBe(true)
    expect(processBelongsToTurn(turnAt, undefined)).toBe(true)
  })

  it('uses the longer launch window of Copilot and OpenCode', () => {
    expect(processBelongsToTurn(turnAt + 120_000, turnAt, 120_000)).toBe(true)
    expect(processBelongsToTurn(turnAt + 120_001, turnAt, 120_000)).toBe(false)
  })
})

describe('turnStartedAt', () => {
  it('reads the last turn timestamp from output paths on either platform', () => {
    expect(turnStartedAt('/state/codex/turns/EKR-33-1790000000000.jsonl')).toBe(1_790_000_000_000)
    expect(turnStartedAt('D:\\state\\codex\\turns\\EKR-33-1790000060000.jsonl')).toBe(1_790_000_060_000)
  })

  it('leaves unrecognised output names unknown', () => {
    expect(turnStartedAt('/state/codex/turns/unknown.jsonl')).toBeUndefined()
    expect(turnStartedAt('/state/codex/turns/task-123.jsonl.bak')).toBeUndefined()
  })
})
