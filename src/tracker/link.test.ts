import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitlabApi } from '../gitlab/api.js'
import type { TrackerHealth } from './health.js'
import { errorText, TrackerLink } from './link.js'
import { TrackerNotFound, type Tracker } from './source.js'

function fakeSource(): Tracker & { closed: boolean } {
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

describe('TrackerLink', () => {
  it('backs off repeated timeouts, logs once and counts them until that operation recovers', async () => {
    vi.useFakeTimers()
    const log = vi.fn()
    const source = fakeSource()
    let hangs = true
    source.tasks = vi.fn(async () => hangs ? new Promise(() => {}) : []) as typeof source.tasks
    const connect = vi.fn(async () => source)
    const link = new TrackerLink({ name: 'gitlab', connect, timeoutMs: 1000, onDiagnostic: log })
    const run = () => link.run((tracker) => tracker.tasks([]), 'tasks')
    for (let attempt = 0; attempt < 2; attempt++) {
      const rejected = expect(run()).rejects.toThrow('call timed out')
      await vi.advanceTimersByTimeAsync(1000)
      await rejected
      const calls = connect.mock.calls.length
      await expect(run()).rejects.toThrow('call timed out')
      expect(connect).toHaveBeenCalledTimes(calls)
      await vi.advanceTimersByTimeAsync(attempt === 0 ? 20_000 : 40_000)
    }
    expect(log).toHaveBeenCalledTimes(1)
    await link.run((tracker) => tracker.chainTasks('APP', {} as never))
    expect(log).toHaveBeenCalledTimes(1)
    hangs = false
    await run()
    expect(log).toHaveBeenLastCalledWith('gitlab: tasks reads again after 2 timeouts')
    await run()
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('cancels HTTP work on timeout and lets a profile reset bypass the retry delay', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const fetchImpl: typeof fetch = async (_, init) => new Promise((_, reject) => {
      signal = init?.signal
      signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
    })
    const api = new GitlabApi('https://example.com', 'fake', 5000, fetchImpl)
    const source = fakeSource()
    source.tasks = async () => { await api.request('/api/v4/issues'); return [] }
    const log = vi.fn()
    const link = new TrackerLink({ name: 'gitlab', connect: async () => source, timeoutMs: 1000, onDiagnostic: log })
    const rejected = expect(link.run((tracker) => tracker.tasks([]), 'tasks')).rejects.toThrow('call timed out')
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(signal?.aborted).toBe(true)
    link.reset()
    source.tasks = async () => []
    await expect(link.run((tracker) => tracker.tasks([]), 'tasks')).resolves.toEqual([])
  })

  it('logs timeout details without changing the health error', async () => {
    vi.useFakeTimers()
    const log = vi.fn()
    const source = fakeSource()
    source.tasks = async () => {
      const api = new GitlabApi('https://example.com', 'fake', 5000, async () => new Promise(() => {}))
      await api.request('/api/v4/issues?token=secret')
      return []
    }
    const link = new TrackerLink({ name: 'gitlab', connect: async () => source, timeoutMs: 1000, onDiagnostic: log })
    const pending = link.run((tracker) => tracker.tasks([]))
    const rejected = expect(pending).rejects.toThrow('gitlab: call timed out after 1000 ms')
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/tasks.*1000 ms.*1 HTTP request/))
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/longest 1000 ms \/api\/v4\/issues/))
    expect(log.mock.calls[0]![0]).not.toContain('secret')
    expect(link.health.error).toBe('gitlab: call timed out after 1000 ms')
  })

  it('throttles slow successful calls separately by operation', async () => {
    vi.useFakeTimers()
    const log = vi.fn()
    const source = fakeSource()
    source.tasks = async () => { await new Promise((resolve) => setTimeout(resolve, 600)); return [] }
    const link = new TrackerLink({ name: 'gitlab', connect: async () => source, timeoutMs: 1000, onDiagnostic: log })
    for (let i = 0; i < 2; i++) {
      const pending = link.run((tracker) => tracker.tasks([]))
      await vi.advanceTimersByTimeAsync(600)
      await pending
    }
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/tasks.*600 ms/))
    await vi.advanceTimersByTimeAsync(600000)
    const pending = link.run((tracker) => tracker.tasks([]))
    await vi.advanceTimersByTimeAsync(600)
    await pending
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('keeps concurrent calls and their request counts separate', async () => {
    vi.useFakeTimers()
    const log = vi.fn()
    const api = new GitlabApi('https://example.com', 'fake', 5000, async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      return new Response('{}')
    })
    const source = fakeSource()
    source.tasks = async () => { await api.request('/api/v4/issues'); return [] }
    source.chainTasks = async () => { await Promise.all([api.request('/api/graphql'), api.request('/api/graphql')]); return { tasks: [], unknownStatuses: [] } }
    const link = new TrackerLink({ name: 'gitlab', connect: async () => source, timeoutMs: 1000, onDiagnostic: log })
    const calls = Promise.all([link.run((tracker) => tracker.tasks([])), link.run((tracker) => tracker.chainTasks('X', {} as never))])
    await vi.advanceTimersByTimeAsync(600)
    await calls
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/tasks.*1 HTTP request/))
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/chainTasks.*2 HTTP requests/))
  })
  it('connects once and reuses the connection', async () => {
    const connect = vi.fn(async () => fakeSource())
    const link = new TrackerLink({ name: 'huly',connect, timeoutMs: 1000 })
    await link.run(async () => 1)
    await link.run(async () => 2)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('shares a single pending connect between concurrent runs', async () => {
    const connect = vi.fn(async () => fakeSource())
    const link = new TrackerLink({ name: 'huly',connect, timeoutMs: 1000 })
    await Promise.all([link.run(async () => 1), link.run(async () => 2)])
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('drops the connection after a failed call and reconnects on the next one', async () => {
    const first = fakeSource()
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(fakeSource())
    const link = new TrackerLink({ name: 'huly',connect, timeoutMs: 1000 })

    await expect(link.run(async () => Promise.reject(new Error('socket closed')))).rejects.toThrow('socket closed')
    expect(first.closed).toBe(true)

    await expect(link.run(async () => 'ok')).resolves.toBe('ok')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('keeps the connection, live, when the tracker answers that what was asked for is not there', async () => {
    const source = fakeSource()
    const connect = vi.fn(async () => source)
    const link = new TrackerLink({ name: 'huly', connect, timeoutMs: 1000 })
    const missing = new TrackerNotFound('huly: project APP not found')

    await expect(link.run(async () => Promise.reject(missing))).rejects.toBe(missing)
    expect(source.closed).toBe(false)
    expect(link.health).toEqual(expect.objectContaining({ state: 'live', error: null }))

    await link.run(async () => 1)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('retries the connect itself after it failed', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce(fakeSource())
    const link = new TrackerLink({ name: 'huly',connect, timeoutMs: 1000 })
    await expect(link.run(async () => 'x')).rejects.toThrow('refused')
    await expect(link.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('treats a call that hangs past the timeout as a broken connection', async () => {
    vi.useFakeTimers()
    const source = fakeSource()
    const link = new TrackerLink({ name: 'huly',connect: async () => source, timeoutMs: 1000 })
    const pending = link.run(() => new Promise(() => {}))
    const assertion = expect(pending).rejects.toThrow(/^huly: call timed out/)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(source.closed).toBe(true)
  })

  it('reports connecting before the first answer, then live with the time of the last success', async () => {
    const health: TrackerHealth[] = []
    let now = new Date('2026-01-01T10:00:00.000Z')
    const link = new TrackerLink({
      name: 'huly',
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
    const link = new TrackerLink({ name: 'huly',connect: async () => fakeSource(), timeoutMs: 1000, now: () => now })
    await link.run(async () => 1)

    now = new Date('2026-01-01T10:01:00.000Z')
    await expect(link.run(async () => Promise.reject(new Error('socket closed')))).rejects.toThrow()
    expect(link.health).toEqual({ state: 'down', lastOkAt: '2026-01-01T10:00:00.000Z', error: 'socket closed' })

    now = new Date('2026-01-01T10:02:00.000Z')
    await link.run(async () => 2)
    expect(link.health).toEqual({ state: 'live', lastOkAt: '2026-01-01T10:02:00.000Z', error: null })
  })

  it('reports down when the connect itself fails before any success', async () => {
    const link = new TrackerLink({ name: 'huly',connect: async () => Promise.reject(new Error('refused')), timeoutMs: 1000 })
    await expect(link.run(async () => 1)).rejects.toThrow()
    expect(link.health).toEqual({ state: 'down', lastOkAt: null, error: 'refused' })
  })

  it('names the cause of a failed fetch, which alone says only "fetch failed"', async () => {
    const failed = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND huly.example.com') })
    const link = new TrackerLink({ name: 'huly', connect: async () => Promise.reject(failed), timeoutMs: 1000 })
    await expect(link.run(async () => 1)).rejects.toThrow()
    expect(link.health.error).toBe('fetch failed: getaddrinfo ENOTFOUND huly.example.com')
    expect(errorText(failed)).toBe('fetch failed: getaddrinfo ENOTFOUND huly.example.com')
  })

  it('does not report a change when a failure repeats with the same error', async () => {
    const onHealth = vi.fn()
    const link = new TrackerLink({ name: 'huly',connect: async () => Promise.reject(new Error('refused')), timeoutMs: 1000, onHealth })
    await expect(link.run(async () => 1)).rejects.toThrow()
    await expect(link.run(async () => 1)).rejects.toThrow()
    expect(onHealth).toHaveBeenCalledTimes(1)
  })

  it('closes the live connection and refuses further calls', async () => {
    const source = fakeSource()
    const link = new TrackerLink({ name: 'huly',connect: async () => source, timeoutMs: 1000 })
    await link.run(async () => 1)
    await link.close()
    expect(source.closed).toBe(true)
    await expect(link.run(async () => 1)).rejects.toThrow(/closed/)
  })

  it('closes the live connection on a reset, and the next call connects again', async () => {
    const first = fakeSource()
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(fakeSource())
    const onHealth = vi.fn<(health: TrackerHealth) => void>()
    const link = new TrackerLink({ name: 'huly', connect, timeoutMs: 1000, onHealth })
    await link.run(async () => 1)
    link.reset()
    await vi.waitFor(() => expect(first.closed).toBe(true))
    expect(link.health.state).toBe('connecting')
    expect(onHealth).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'connecting' }))
    await link.run(async () => 2)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
