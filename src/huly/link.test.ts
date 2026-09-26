import { afterEach, describe, expect, it, vi } from 'vitest'
import { HulyLink } from './link.js'
import type { HulySource } from './source.js'

function fakeSource(): HulySource & { closed: boolean } {
  return {
    closed: false,
    openTasks: async () => [],
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

  it('closes the live connection and refuses further calls', async () => {
    const source = fakeSource()
    const link = new HulyLink({ connect: async () => source, timeoutMs: 1000 })
    await link.run(async () => 1)
    await link.close()
    expect(source.closed).toBe(true)
    await expect(link.run(async () => 1)).rejects.toThrow(/closed/)
  })
})
