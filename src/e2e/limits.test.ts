import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LimitWindow } from '../limits/model.js'
import { busyChains } from '../updates/settle.js'
import { commitAndMerge, Gate } from './agent.fixture.js'
import { ACCOUNT, Harness, PROJECT_ID } from './service.fixture.js'

const WEEK_RESET = '2026-10-05T09:00:00.000Z'
const week = (usedPercentage: number): LimitWindow => ({ usedPercentage, resetsAt: WEEK_RESET })
const hours = (usedPercentage: number, resetsAt: string): LimitWindow => ({ usedPercentage, resetsAt })

describe('limits end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')
  const shown = () => run.service.limits.limits(ACCOUNT)

  /** Starts the service, waits for its first poll to be known, and restarts it with the next polls held by a gate. */
  async function restartUnpolled(down = 0): Promise<Gate> {
    await run.until(() => run.agent.polls.length > 0 && shown() !== null, 'the first poll answered')
    const gate = new Gate()
    await run.restart(() => {
      vi.setSystemTime(Date.now() + down)
      run.agent.usageGate = gate
    })
    return gate
  }

  it('ends the wait for a limit once a poll shows the account reset early, and resumes the same session', async () => {
    const early = Date.parse('2026-10-01T09:40:00Z')
    let used = 90
    run.agent.windows = (_account, at) => (Date.parse(at) >= early ? { fiveHour: null, sevenDay: week(40) } : { fiveHour: hours(used, '2026-10-01T13:00:00.000Z'), sevenDay: week(40) })
    run.board.add('ABC-1')
    run.agent.script(
      'ABC-1',
      async () => {
        used = 100
        return { limit: "You've hit your session limit · resets 1:00pm (UTC)" }
      },
      commitAndMerge(),
    )
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.log.some((line) => line.includes('ABC-1') && line.includes('limit')), 'the limit seen')

    await run.until(() => Date.now() >= early, 'the early reset', { step: 60_000, limitMs: 60 * 60_000 })
    expect(resumes()).toEqual([])
    await run.until(() => resumes().length === 1, 'the session resumed', { step: 10_000, limitMs: 10 * 60_000 })

    // Within one poll of the reset, hours before the reset the refusal named.
    expect(Date.now()).toBeLessThanOrEqual(early + 5 * 60_000 + 30_000)
    expect(run.log).toEqual(expect.arrayContaining([expect.stringMatching(/ABC-1: limit on account script open again at .* before the named reset at 2026-10-01T13:00:00\.000Z; next: resume/)]))
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(resumes()[0]!.sessionId).toBe(launches()[0]!.sessionId)
    expect(launches()).toHaveLength(1)
  })

  it('resumes a session the week of Fable refused once a reset empties that week, its end kept in place', async () => {
    const pressed = Date.parse('2026-10-01T09:40:00Z')
    let fable = 93
    run.project.models = { claude: 'fable' }
    run.agent.windows = (_account, at) => {
      const reset = Date.parse(at) >= pressed
      return {
        fiveHour: reset ? null : hours(30, '2026-10-01T13:00:00.000Z'),
        sevenDay: week(reset ? 21 : 67),
        models: { weeks: [{ model: 'Fable', usedPercentage: reset ? 0 : fable, resetsAt: WEEK_RESET }], updatedAt: at },
      }
    }
    run.board.add('ABC-1')
    run.agent.script(
      'ABC-1',
      async () => {
        fable = 100
        return { limit: "You've hit your Fable limit · resets Oct 5, 9am (UTC)" }
      },
      commitAndMerge(),
    )
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.log.some((line) => line.includes('ABC-1') && line.includes(`resets at ${WEEK_RESET}`)), 'the week named')

    await run.until(() => Date.now() >= pressed, 'the reset pressed', { step: 60_000, limitMs: 60 * 60_000 })
    expect(resumes()).toEqual([])
    await run.until(() => resumes().length === 1, 'the session resumed', { step: 10_000, limitMs: 10 * 60_000 })
    expect(Date.now()).toBeLessThanOrEqual(pressed + 5 * 60_000 + 30_000)
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('after a restart, holds the next task until the first poll answers, and keeps it out of a spent window', async () => {
    const reset = '2026-10-01T11:00:00.000Z'
    run.agent.windows = (_account, at) => (at < reset ? { fiveHour: hours(100, reset), sevenDay: week(40) } : { fiveHour: null, sevenDay: week(40) })
    run.board.add('ABC-1')
    run.agent.script('ABC-1', commitAndMerge())
    await run.start()
    // Ten minutes down: the limits kept from before are older than a poll's interval and stand in for no poll.
    const gate = await restartUnpolled(10 * 60_000)
    await run.startChain(PROJECT_ID)

    await run.until(() => run.log.some((line) => line.includes('ABC-1 waits for the first limits poll of script')), 'the wait for the first poll')
    await run.pass(3 * 60_000)
    expect(launches()).toEqual([])
    expect(busyChains(run.service.dispatcher.state.active, new Date())).toEqual([PROJECT_ID])

    gate.open()
    await run.until(() => run.service.limits.usage(ACCOUNT).state === 'ok', 'the first poll answered')
    await run.pass(3 * 60_000)
    expect(launches()).toEqual([])
    expect(run.service.dispatcher.state.active[0]?.limitUntil).toBe(reset)
    expect(busyChains(run.service.dispatcher.state.active, new Date())).toEqual([])

    await run.until(() => launches().length === 1, 'ABC-1 launched', { step: 60_000, limitMs: 2 * 60 * 60_000 })
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(reset))
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('after a restart, launches the next task as soon as the first poll shows the window free', async () => {
    run.agent.windows = () => ({ fiveHour: hours(20, '2026-10-01T13:00:00.000Z'), sevenDay: week(40) })
    run.board.add('ABC-1')
    run.agent.script('ABC-1', commitAndMerge())
    await run.start()
    const gate = await restartUnpolled(10 * 60_000)
    await run.startChain(PROJECT_ID)

    await run.until(() => run.log.some((line) => line.includes('ABC-1 waits for the first limits poll of script')), 'the wait for the first poll')
    await run.pass(3 * 60_000)
    expect(launches()).toEqual([])

    const opened = Date.now()
    gate.open()
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    expect(Date.now() - opened).toBeLessThan(30_000)
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('keeps the limits through a restart: a fresh snapshot lifts the wait for the first poll', async () => {
    run.agent.windows = () => ({ fiveHour: hours(30, '2026-10-01T13:00:00.000Z'), sevenDay: week(40) })
    run.board.add('ABC-1')
    run.agent.script('ABC-1', commitAndMerge())
    await run.start()
    const gate = await restartUnpolled()

    expect(shown()?.fiveHour?.usedPercentage).toBe(30)
    expect(run.service.limits.outdated(ACCOUNT)).toBe(false)
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched on the kept limits')
    // The poll after the restart is still held: the kept snapshot let the task go.
    expect(run.service.limits.usage(ACCOUNT).state).toBe('waiting')
    gate.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('takes the windows a session reports mid-turn between the polls, the window it did not name kept from the poll', async () => {
    run.agent.windows = () => ({ fiveHour: hours(20, '2026-10-01T13:00:00.000Z'), sevenDay: week(40) })
    run.board.add('ABC-1')
    let reported = false
    const gate = new Gate()
    run.agent.script('ABC-1', async (turn) => {
      turn.limits({ fiveHour: hours(77, '2026-10-01T13:00:00.000Z') })
      reported = true
      await turn.park(gate)
      return commitAndMerge()(turn)
    })
    await run.start()
    await run.until(() => shown()?.source === 'usage', 'the first poll answered')
    const polls = run.agent.polls.length
    await run.startChain(PROJECT_ID)
    await run.until(() => reported, 'the windows reported')
    await run.pass(5_000)

    expect(run.agent.polls).toHaveLength(polls)
    expect(shown()).toMatchObject({ source: 'sdk', fiveHour: hours(77, '2026-10-01T13:00:00.000Z'), sevenDay: week(40) })
    expect(run.service.account.view.accounts.find((entry) => entry.key === ACCOUNT)?.limits?.fiveHour?.usedPercentage).toBe(77)
    gate.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })

  it('keeps the limits through a restart: an old snapshot is shown outdated, without a window that reset meanwhile, until a poll answers', async () => {
    const restarted = Date.parse('2026-10-01T09:10:00Z')
    run.agent.windows = (_account, at) =>
      Date.parse(at) < restarted ? { fiveHour: hours(100, '2026-10-01T09:05:00.000Z'), sevenDay: week(30) } : { fiveHour: hours(10, '2026-10-01T14:10:00.000Z'), sevenDay: week(31) }
    await run.start()
    const gate = await restartUnpolled(10 * 60_000)
    await run.pass(5_000)

    expect(shown()).toMatchObject({ fiveHour: null, sevenDay: week(30) })
    expect(run.service.limits.outdated(ACCOUNT)).toBe(true)
    expect(run.service.account.view.accounts.find((entry) => entry.key === ACCOUNT)?.limitsOutdated).toBe(true)

    gate.open()
    await run.until(() => run.service.limits.outdated(ACCOUNT) === false, 'the outdated mark gone')
    expect(shown()).toMatchObject({ fiveHour: hours(10, '2026-10-01T14:10:00.000Z'), sevenDay: week(31) })
    await run.until(() => run.service.account.view.accounts.find((entry) => entry.key === ACCOUNT)?.limitsOutdated === undefined, 'the card without the mark')
  })

  it('holds the next task while the week of its model is used up, and launches it once the week opens (BTN-816)', async () => {
    const opens = Date.parse('2026-10-01T09:20:00Z')
    run.project.models = { claude: 'fable' }
    run.agent.windows = (_account, at) => ({
      fiveHour: hours(20, '2026-10-01T13:00:00.000Z'),
      sevenDay: week(40),
      models: { weeks: [{ model: 'Fable', usedPercentage: Date.parse(at) >= opens ? 0 : 100, resetsAt: null }], updatedAt: at },
    })
    run.board.add('ABC-1')
    run.agent.script('ABC-1', commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.service.dispatcher.state.active[0]?.modelWeek?.model === 'Fable', 'the week of the model holds the chain')
    expect(launches()).toEqual([])
    expect(busyChains(run.service.dispatcher.state.active, new Date())).toEqual([])

    await run.pass(25 * 60_000)
    await run.until(() => launches().length === 1, 'ABC-1 launched', { step: 30_000, limitMs: 10 * 60_000 })
    expect(run.service.dispatcher.state.active[0]?.modelWeek).toBeUndefined()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })
})
