import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HulyHealth } from './health.js'
import { HulyLink } from './link.js'
import type { HulySource } from './source.js'

function fakeSource(): HulySource & { closed: boolean } {
  return {
    closed: false,
    chainTasks: async () => ({ tasks: [], unknownStatuses: [] }),
    tasks: async () => [],
    async close() {
      this.closed = true
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('HulyLink', () => {
  it('connects once and reuses the connection', async () => {
    const connect = vi.fn(async () => fakeSource())
    const link = new HulyLink({ connect, timeoutMs: 1000 })
    await link.run(async () => 1)
    await link.run(async () => 2)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('shares a single pending connect between concurrent runs', async () => {
    const connect = vi.fn(async () => fakeSource())
    const link = new HulyLink({ connect, timeoutMs: 1000 })
    await Promise.all([link.run(async () => 1), link.run(async () => 2)])
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('drops the connection after a failed call and reconnects on the next one', async () => {
    const first = fakeSource()
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(fakeSource())
    const link = new HulyLink({ connect, timeoutMs: 1000 })

    await expect(link.run(async () => Promise.reject(new Error('socket closed')))).rejects.toThrow('socket closed')
    expect(first.closed).toBe(true)

    await expect(link.run(async () => 'ok')).resolves.toBe('ok')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('retries the connect itself after it failed', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce(fakeSource())
    const link = new HulyLink({ connect, timeoutMs: 1000 })
    await expect(link.run(async () => 'x')).rejects.toThrow('refused')
    await expect(link.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('treats a call that hangs past the timeout as a broken connection', async () => {
    vi.useFakeTimers()
    const source = fakeSource()
    const link = new HulyLink({ connect: async () => source, timeoutMs: 1000 })
    const pending = link.run(() => new Promise(() => {}))
    const assertion = expect(pending).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(source.closed).toBe(true)
  })

  it('reports connecting before the first answer, then live with the time of the last success', async () => {
    const health: HulyHealth[] = []
    let now = new Date('2026-01-01T10:00:00.000Z')
    const link = new HulyLink({
      connect: async () => fakeSource(),
      timeoutMs: 1000,
      now: () => now,
      onHealth: (value) => health.push(value),
    })
    expect(link.health).toEqual({ state: 'connecting', lastOkAt: null, error: null })

    await link.run(async () => 1)
    now = new Date('2026-01-01T10:00:05.000Z')
    await link.run(async () => 2)

    expect(link.health).toEqual({ state: 'live', lastOkAt: '2026-01-01T10:00:05.000Z', error: null })
    expect(health.map((value) => value.lastOkAt)).toEqual(['2026-01-01T10:00:00.000Z', '2026-01-01T10:00:05.000Z'])
  })

  it('reports down with the error and keeps the last success until a call goes through again', async () => {
    let now = new Date('2026-01-01T10:00:00.000Z')
    const link = new HulyLink({ connect: async () => fakeSource(), timeoutMs: 1000, now: () => now })
    await link.run(async () => 1)

    now = new Date('2026-01-01T10:01:00.000Z')
    await expect(link.run(async () => Promise.reject(new Error('socket closed')))).rejects.toThrow()
    expect(link.health).toEqual({ state: 'down', lastOkAt: '2026-01-01T10:00:00.000Z', error: 'socket closed' })

    now = new Date('2026-01-01T10:02:00.000Z')
    await link.run(async () => 2)
    expect(link.health).toEqual({ state: 'live', lastOkAt: '2026-01-01T10:02:00.000Z', error: null })
  })

  it('reports down when the connect itself fails before any success', async () => {
    const link = new HulyLink({ connect: async () => Promise.reject(new Error('refused')), timeoutMs: 1000 })
    await expect(link.run(async () => 1)).rejects.toThrow()
    expect(link.health).toEqual({ state: 'down', lastOkAt: null, error: 'refused' })
  })

  it('does not report a change when a failure repeats with the same error', async () => {
    const onHealth = vi.fn()
    const link = new HulyLink({ connect: async () => Promise.reject(new Error('refused')), timeoutMs: 1000, onHealth })
    await expect(link.run(async () => 1)).rejects.toThrow()
    await expect(link.run(async () => 1)).rejects.toThrow()
    expect(onHealth).toHaveBeenCalledTimes(1)
  })

  it('closes the live connection and refuses further calls', async () => {
    const source = fakeSource()
    const link = new HulyLink({ connect: async () => source, timeoutMs: 1000 })
    await link.run(async () => 1)
    await link.close()
    expect(source.closed).toBe(true)
    await expect(link.run(async () => 1)).rejects.toThrow(/closed/)
  })
})
