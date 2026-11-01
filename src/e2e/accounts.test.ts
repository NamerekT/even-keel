import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LimitWindow } from '../limits/model.js'
import { commitAndMerge, ends } from './agent.fixture.js'
import { ACCOUNT, Harness, PROJECT_ID, SPARE_ACCOUNT } from './service.fixture.js'

const week = (usedPercentage: number): LimitWindow => ({ usedPercentage, resetsAt: '2026-10-05T09:00:00.000Z' })
/** A refusal that names no reset, as Copilot's and OpenCode Zen's do. */
const NO_RESET = "You've reached your usage limit. Please try again later."

describe('accounts and limits end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')
  const stops = () => run.agent.calls.filter((call) => call.kind === 'stop')
  const limitSeen = (task: string) => run.log.some((line) => line.includes(`${task}: limit reached`))

  it('holds a session refused for credit on a key untouched, and hands the task to the account switched to', async () => {
    run.spare = true
    run.agent.statuses.set(ACCOUNT, { authMethod: 'api_key', email: null, subscriptionType: null })
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', ends({ credit: 'Credit balance is too low' }), commitAndMerge('ABC-1.txt'))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => limitSeen('ABC-1'), 'the refusal seen')
    const [first] = launches()

    await run.pass(30 * 60_000, 60_000)
    expect(launches()).toHaveLength(1)
    expect(resumes()).toEqual([])
    expect(stops()).toEqual([])

    await run.post('account/switch', { account: SPARE_ACCOUNT })
    await run.until(() => launches().length === 2, 'a new session on the switched account')
    const second = launches()[1]!
    expect(second).toMatchObject({ task: 'ABC-1', account: SPARE_ACCOUNT, cwd: first!.cwd })
    expect(run.service.launches).toEqual(expect.arrayContaining([expect.objectContaining({ task: 'ABC-1', reason: 'relay', cause: 'credit', previous: first!.sessionId })]))
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(launches().map((call) => [call.task, call.account])).toEqual([
      ['ABC-1', ACCOUNT],
      ['ABC-1', SPARE_ACCOUNT],
      ['ABC-2', SPARE_ACCOUNT],
    ])
  })

  it('waits out a limit that names no reset until the reset a later poll gives, the next task behind it', { timeout: 120_000 }, async () => {
    const reset = '2026-10-01T11:00:00.000Z'
    let hit = false
    run.agent.windows = (_account, at) => (hit && at < reset ? { fiveHour: { usedPercentage: 100, resetsAt: reset }, sevenDay: week(40) } : { fiveHour: { usedPercentage: 60, resetsAt: reset }, sevenDay: week(40) })
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script(
      'ABC-1',
      async () => {
        hit = true
        return { limit: NO_RESET }
      },
      commitAndMerge('ABC-1.txt'),
    )
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => limitSeen('ABC-1'), 'the limit seen')
    expect(run.log).toEqual(expect.arrayContaining([expect.stringContaining('ABC-1: limit reached on account script; reset unknown')]))

    await run.until(() => run.log.some((line) => line.includes(`ABC-1: limit reset updated to ${reset}`)), 'the reset a poll gave', { step: 60_000, limitMs: 10 * 60_000 })
    await run.until(() => Date.now() >= Date.parse(reset) - 60_000, 'the clock near the reset', { step: 60_000, limitMs: 2 * 60 * 60_000 })
    expect(launches()).toHaveLength(1)
    expect(resumes()).toEqual([])

    await run.until(() => launches().length === 2, 'ABC-1 handed over after the reset', { step: 10_000, limitMs: 10 * 60_000 })
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(reset))
    expect(launches()[1]!.task).toBe('ABC-1')
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
  })

  it('tries again a quarter of an hour after a limit nothing tells the reset of, not waiting for good', async () => {
    run.agent.windows = () => 'missing'
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ limit: NO_RESET }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => limitSeen('ABC-1'), 'the limit seen')
    const hit = Date.now()

    await run.until(() => Date.now() >= hit + 14 * 60_000, 'the clock near the retry', { step: 60_000, limitMs: 20 * 60_000 })
    expect(resumes()).toEqual([])
    await run.until(() => resumes().length === 1, 'the session resumed', { step: 10_000, limitMs: 5 * 60_000 })
    expect(Date.now()).toBeGreaterThanOrEqual(hit + 15 * 60_000 - 5_000)
    expect(resumes()[0]!.sessionId).toBe(launches()[0]!.sessionId)
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('hands a task held on a limit with no reset to a new session at once on the account switched to', async () => {
    run.spare = true
    run.agent.windows = () => 'missing'
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ limit: NO_RESET }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => limitSeen('ABC-1'), 'the limit seen')

    const switched = Date.now()
    await run.post('account/switch', { account: SPARE_ACCOUNT })
    await run.until(() => launches().length === 2, 'a new session on the switched account')
    expect(Date.now() - switched).toBeLessThan(60_000)
    expect(launches()[1]).toMatchObject({ task: 'ABC-1', account: SPARE_ACCOUNT })
    expect(resumes()).toEqual([])
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('waits out a limit of an account with no e-mail in the same session, with no handovers meanwhile', async () => {
    run.agent.statuses.set(ACCOUNT, { email: null })
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ limit: "You've hit your session limit · resets 9:45am (UTC)" }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => limitSeen('ABC-1'), 'the limit seen')

    await run.pass(10 * 60_000, 10_000)
    expect(launches()).toHaveLength(1)
    expect(stops()).toEqual([])
    expect(resumes()).toEqual([])

    await run.until(() => resumes().length === 1, 'the session resumed after the reset', { step: 60_000, limitMs: 60 * 60_000 })
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse('2026-10-01T09:45:00Z'))
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(launches()).toHaveLength(1)
  })
})
