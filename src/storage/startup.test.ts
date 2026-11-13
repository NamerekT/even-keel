import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseHeldError } from './owner.js'
import { startWithStorageRetry } from './startup.js'

afterEach(() => vi.useRealTimers())

describe('storage startup recovery', () => {
  const held = (pid = 123) => new DatabaseHeldError('state/even-keel', { pid, since: Date.now() })
  const page = () => ({ update: vi.fn(), close: vi.fn(async () => {}) })

  it('starts normally without opening a blocked page', async () => {
    const blocked = vi.fn()
    expect(await startWithStorageRetry({ prepare: vi.fn(), blocked, log: vi.fn() })).toBe(true)
    expect(blocked).not.toHaveBeenCalled()
  })

  it('waits through repeated refusals, updates the holder, and closes the page before starting', async () => {
    vi.useFakeTimers()
    const first = held()
    const second = held(456)
    const prepare = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second).mockResolvedValue(undefined)
    const shown = page()
    const blocked = vi.fn(async () => shown)
    const log = vi.fn()
    const started = startWithStorageRetry({ prepare, blocked, log })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(shown.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(shown.update).toHaveBeenCalledWith(second)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await started).toBe(true)
    expect(blocked).toHaveBeenCalledExactlyOnceWith(first)
    expect(shown.close).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith('storage: database opened after waiting; starting the service')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prepare).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-ownership failure', async () => {
    vi.useFakeTimers()
    const error = new Error('damaged database')
    const prepare = vi.fn().mockRejectedValue(error)
    const shown = page()
    const blocked = vi.fn(async () => shown)
    expect(await startWithStorageRetry({ prepare, blocked, log: vi.fn() })).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prepare).toHaveBeenCalledOnce()
    expect(blocked).toHaveBeenCalledExactlyOnceWith(error)
    expect(shown.close).not.toHaveBeenCalled()
  })

  it('replaces the refusal with a different error and stops retrying', async () => {
    vi.useFakeTimers()
    const error = new Error('unsupported schema')
    const prepare = vi.fn().mockRejectedValueOnce(held()).mockRejectedValue(error)
    const shown = page()
    const started = startWithStorageRetry({ prepare, blocked: async () => shown, log: vi.fn() })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await started).toBe(false)
    expect(shown.update).toHaveBeenCalledExactlyOnceWith(error)
    expect(shown.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prepare).toHaveBeenCalledTimes(2)
  })
})
