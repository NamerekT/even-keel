import { describe, expect, it, vi } from 'vitest'
import { killOrphans, markOf, orphansIn, parseDarwinTable, parseLinuxStat, type ProcessEnv } from './orphans.js'

const row = (pid: number, ppid: number, command: string, env?: string[]): ProcessEnv => ({ pid, ppid, command, ...(env === undefined ? {} : { env }) })

describe('markOf', () => {
  it("names the session of a Claude or Codex command's environment", () => {
    const ids = new Set(['session-1', 'thread-2'])
    expect(markOf(['PATH=/bin', 'CLAUDE_CODE_SESSION_ID=session-1'], ids)).toBe('session-1')
    expect(markOf(['CODEX_THREAD_ID=thread-2'], ids)).toBe('thread-2')
  })

  it('ignores a session of another task and a value under another name', () => {
    const ids = new Set(['session-1'])
    expect(markOf(['CLAUDE_CODE_SESSION_ID=session-9'], ids)).toBeUndefined()
    expect(markOf(['SOME_ID=session-1'], ids)).toBeUndefined()
  })
})

describe('orphansIn', () => {
  it("takes the marked processes and their unmarked children, the way Chrome drops a parent's environment", () => {
    const table = [
      row(1, 0, 'init', []),
      row(10, 1, 'node', ['CLAUDE_CODE_SESSION_ID=gone']),
      row(11, 10, 'chrome'),
      row(12, 11, 'chrome'),
      row(20, 1, 'node', ['CLAUDE_CODE_SESSION_ID=other']),
      row(21, 20, 'chrome'),
    ]
    expect(orphansIn(table, new Set(['gone']), 999)).toEqual([
      { pid: 10, command: 'node', session: 'gone' },
      { pid: 11, command: 'chrome', session: 'gone' },
      { pid: 12, command: 'chrome', session: 'gone' },
    ])
  })

  it('never takes the service itself or the processes it runs under', () => {
    const table = [
      row(5, 1, 'claude', ['CLAUDE_CODE_SESSION_ID=gone']),
      row(6, 5, 'node', ['CLAUDE_CODE_SESSION_ID=gone']),
      row(7, 6, 'git', ['CLAUDE_CODE_SESSION_ID=gone']),
    ]
    expect(orphansIn(table, new Set(['gone']), 6)).toEqual([{ pid: 7, command: 'git', session: 'gone' }])
  })
})

describe('the process listings', () => {
  it('reads the parent and the name from a Linux stat line whose name holds spaces and parentheses', () => {
    expect(parseLinuxStat('4242 (npm run (dev)) S 17 4242 17 0 -1')).toEqual({ ppid: 17, command: 'npm run (dev)' })
    expect(parseLinuxStat('garbage')).toBeUndefined()
  })

  it("splits macOS's `ps -E` lines into the command and its environment", () => {
    const text = '  301     1 /usr/local/bin/node server.js PATH=/usr/bin CLAUDE_CODE_SESSION_ID=abc\n    9     1 /sbin/launchd\n'
    expect(parseDarwinTable(text)).toEqual([
      { pid: 301, ppid: 1, command: 'node', env: ['PATH=/usr/bin', 'CLAUDE_CODE_SESSION_ID=abc'] },
      { pid: 9, ppid: 1, command: 'launchd', env: [] },
    ])
  })
})

describe('killOrphans', () => {
  const table = [row(10, 1, 'vite', ['CLAUDE_CODE_SESSION_ID=gone']), row(11, 10, 'esbuild')]

  it('kills the processes of the given sessions and logs each with how long it lived', async () => {
    const kill = vi.fn(async () => {})
    const log = vi.fn()
    await killOrphans(['gone'], 'ABC-1', { scan: async () => table, kill, log, startedAt: async (pid) => (pid === 10 ? 0 : undefined), now: () => 3 * 60_000 })
    expect(kill).toHaveBeenCalledWith([{ pid: 10, startedAt: 0 }, { pid: 11 }])
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      'cleanup: ABC-1: killed the orphaned process 10 (vite) of the session gone, alive 3 min',
      'cleanup: ABC-1: killed the orphaned process 11 (esbuild) of the session gone',
    ])
  })

  it('does nothing without sessions, without a listing on this system or with nothing found', async () => {
    const kill = vi.fn(async () => {})
    const scan = vi.fn(async () => table)
    await killOrphans([], 'ABC-1', { scan, kill, log: vi.fn() })
    await killOrphans(['gone'], 'ABC-1', { scan: undefined, kill, log: vi.fn() })
    await killOrphans(['other'], 'ABC-1', { scan, kill, log: vi.fn() })
    expect(scan).toHaveBeenCalledTimes(1)
    expect(kill).not.toHaveBeenCalled()
  })

  it('logs a failed listing and goes on', async () => {
    const log = vi.fn()
    await killOrphans(['gone'], 'ABC-1', { scan: async () => { throw new Error('ps: not found') }, kill: vi.fn(), log })
    expect(log).toHaveBeenCalledWith("cleanup: ABC-1: looking for its sessions' orphaned processes failed: ps: not found")
  })
})
