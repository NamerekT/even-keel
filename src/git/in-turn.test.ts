import { describe, expect, it } from 'vitest'
import { remoteCallsInTurn } from './in-turn.js'
import type { Git, GitResult } from './types.js'

interface Held {
  cwd: string
  args: string[]
  release: (result?: GitResult) => void
  fail: (error: Error) => void
}

function held(): { git: Git; started: Held[] } {
  const started: Held[] = []
  const git: Git = (cwd, args) =>
    new Promise<GitResult>((resolve, reject) => {
      started.push({ cwd, args, release: (result = { code: 0, out: '' }) => resolve(result), fail: reject })
    })
  return { git, started }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe('remoteCallsInTurn', () => {
  it('starts a fetch of a folder only after the fetch or push already running there ends (BTN-1720)', async () => {
    const { git, started } = held()
    const inTurn = remoteCallsInTurn(git)

    const landing = inTurn('/repo', ['fetch', 'origin'])
    const forward = inTurn('/repo/', ['fetch', 'origin'])
    const push = inTurn('/repo', ['push', 'origin', 'dev'])
    await tick()
    expect(started.map((call) => call.args[0])).toEqual(['fetch'])

    started[0]!.release({ code: 0, out: 'first' })
    expect((await landing).out).toBe('first')
    await tick()
    expect(started).toHaveLength(2)

    started[1]!.fail(new Error('git died'))
    await expect(forward).rejects.toThrow('git died')
    await tick()
    expect(started.map((call) => call.args[0])).toEqual(['fetch', 'fetch', 'push'])
    started[2]!.release()
    expect((await push).code).toBe(0)
  })

  it('runs remote calls of other folders and local calls of the same one at once', async () => {
    const { git, started } = held()
    const inTurn = remoteCallsInTurn(git)

    void inTurn('/repo', ['fetch', 'origin'])
    void inTurn('/other', ['sync'])
    void inTurn('/repo', ['status', '--porcelain'])
    void inTurn('/repo', ['ls-remote', 'origin'])
    await tick()

    expect(started.map((call) => `${call.cwd} ${call.args[0]}`).sort()).toEqual(['/other sync', '/repo fetch', '/repo ls-remote', '/repo status'])
  })
})
