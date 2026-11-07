import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallTimeout } from '../claude/calls.js'
import type { GitResult } from '../git/types.js'
import { leftBehind } from '../git/worktree.js'
import { notice, textNotice } from '../notice/notice.js'
import type { AgentEntry } from '../sessions/agents.js'
import { Lingering } from '../sessions/lingering.js'
import { deferLeftFolder, STOP_RETRY_MS, stopLingering, stopTaskSessions } from './chain.js'

let repo: string
let place: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ekr-99-'))
  place = join(repo, '.claude', 'worktrees', 'abc-1')
  mkdirSync(place, { recursive: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-07T02:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(repo, { recursive: true, force: true })
})

const timedOut = () => new CallTimeout('claude', ['agents', '--json', '--all'])

function setup(stops: (Error | undefined)[]) {
  const agent: AgentEntry = { id: 'agent-1', sessionId: 'session-1', kind: 'script', cwd: place, startedAt: 0, name: 'ABC-1', account: 'global', pid: 1, status: 'idle' }
  const stopIn = vi.fn(async () => {
    const error = stops.shift()
    if (error !== undefined) throw error
  })
  const leftover = vi.fn()
  const ctx = {
    launches: [],
    agents: [agent],
    homeOf: (key: string) => ({ key }),
    stopIn,
    lingering: new Lingering(),
    dispatcher: { leftover },
  } as unknown as Parameters<typeof stopTaskSessions>[0]
  // Git no longer lists the worktree: it unregistered the folder and left it, as on a lock.
  const git = async (): Promise<GitResult> => ({ code: 0, out: '' })
  return { ctx, stopIn, leftover, git }
}

describe('cleanup after Done whose stop timed out (EKR-99)', () => {
  it('keeps the session, stops it on the next tick, then removes the left folder, with nothing on the page', async () => {
    const { ctx, stopIn, leftover, git } = setup([timedOut(), undefined])

    const stopped = await stopTaskSessions(ctx, 'project-1', repo, 'ABC-1', 1)
    expect(stopped).toEqual({ warnings: [], retrying: true })
    const left = leftBehind(place, 'error: Permission denied')
    const other = notice('cleanup.originKept', { branch: 'abc-1/x', remote: 'origin' })
    expect(deferLeftFolder(ctx, 'project-1', repo, 'ABC-1', [left, other])).toEqual([other])

    await stopLingering(ctx, git)
    expect(stopIn).toHaveBeenCalledTimes(2)
    expect(existsSync(place)).toBe(false)
    expect(leftover).not.toHaveBeenCalled()
  })

  it('tries the stop again while it keeps timing out and gives up with a warning once its wait is over', async () => {
    const { ctx, stopIn, leftover, git } = setup([timedOut(), timedOut(), timedOut()])

    await stopTaskSessions(ctx, 'project-1', repo, 'ABC-1', 1)
    await stopLingering(ctx, git)
    expect(stopIn).toHaveBeenCalledTimes(2)
    expect(leftover).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + STOP_RETRY_MS)
    await stopLingering(ctx, git)
    expect(stopIn).toHaveBeenCalledTimes(3)
    expect(leftover).toHaveBeenCalledWith(
      'project-1',
      'ABC-1',
      notice('cleanup.sessionNotStopped', { session: 'session-1' }, { cause: textNotice(timedOut().message) }),
    )
    await stopLingering(ctx, git)
    expect(stopIn).toHaveBeenCalledTimes(3)
  })

  it('warns at once when the stop fails for another reason', async () => {
    const { ctx, leftover } = setup([new Error('claude stop failed')])
    const stopped = await stopTaskSessions(ctx, 'project-1', repo, 'ABC-1', 1)
    expect(stopped.retrying).toBe(false)
    expect(stopped.warnings.map((each) => each.code)).toEqual(['cleanup.sessionNotStopped'])
    expect(leftover).not.toHaveBeenCalled()
  })
})
