import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopOnSignals } from './stop.js'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('stop diagnostics', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('logs %s before shutdown and preserves the normal exit', async (signal) => {
    vi.useFakeTimers()
    const callbacks = new Map<string, () => void>()
    vi.spyOn(process, 'once').mockImplementation(((event: string, callback: () => void) => { callbacks.set(event, callback); return process }) as typeof process.once)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const order: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void order.push(line))
    stopOnSignals(async () => void order.push('shutdown'), 15_000)
    callbacks.get(signal)!()
    await Promise.resolve()
    expect(order).toEqual([`stopping: ${signal}`, 'shutdown'])
    expect(exit).toHaveBeenCalledWith(0)
  })

  it.each(['throw new Error("example failure")', 'Promise.reject(new Error("example failure"))'])('logs a fatal cause and leaves Node to exit nonzero: %s', (failure) => {
    const module = new URL('./stop.ts', import.meta.url).href
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import { logFatalErrors } from ${JSON.stringify(module)}; logFatalErrors(); setImmediate(() => { ${failure} })`], { encoding: 'utf8', timeout: 10_000 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(failure.startsWith('throw') ? 'stopping: uncaughtException' : 'stopping: unhandledRejection')
    expect(result.stderr).toContain('example failure')
  })
})
