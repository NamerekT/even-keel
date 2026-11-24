import { describe, expect, it } from 'vitest'
import type { LandOutcome } from '../git/landing.js'
import { notice, NoticeError } from '../notice/notice.js'
import { done, fakeMachines, setup, task } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import { remoteLandings, resolvingLanding } from './landing-hold.js'
import type { Landing, UnchangedDeps } from './model.js'
import { PROMPTS } from './prompts.js'

const lane = (current: string | null) => ({ current: current === null ? null : { task: current } })

describe('What a landing holds (BTN-1582)', () => {
  it('names the resolving task current in a lane, never one out of the lanes or waiting for the remote', () => {
    expect(resolvingLanding([{ task: 'ABC-1', resolving: true }], [lane('ABC-1'), lane(null)])).toBe('ABC-1')
    expect(resolvingLanding([{ task: 'ABC-1', resolving: true }], [lane('ABC-2')])).toBeUndefined()
    expect(resolvingLanding([{ task: 'ABC-1', resolving: true, waitingRemote: true }], [lane('ABC-1')])).toBeUndefined()
    expect(resolvingLanding([{ task: 'ABC-1' }], [lane('ABC-1')])).toBeUndefined()
    expect(resolvingLanding(undefined, [lane('ABC-1')])).toBeUndefined()
  })

  it('lists the current tasks waiting for the remote', () => {
    const landings = [{ task: 'ABC-1', waitingRemote: true as const }, { task: 'ABC-3', waitingRemote: true as const }, { task: 'ABC-2', resolving: true as const }]
    expect(remoteLandings(landings, [lane('ABC-1'), lane('ABC-2')])).toEqual(['ABC-1'])
  })
})

const resolving = (landing: Landing): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', machine: 'pc', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
  landings: { ABC: [landing] },
})

async function widened(landing: Landing, landingHold?: boolean) {
  const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
  const run = setup({ machines, state: resolving(landing), live: { 'ABC-1': 'old-session' }, ...(landingHold !== undefined && { landingHold }) })
  run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
  await run.dispatcher.idle()
  return run
}

describe('The next start while a session resolves its landing (BTN-1582)', () => {
  it('starts no next task of the project while the setting is on, and logs the wait once', async () => {
    const run = await widened({ task: 'ABC-1', rounds: 1, resolving: true })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.idle()

    expect(run.launched).toEqual([])
    expect(run.dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1' }, paused: false })
    expect(run.log.filter((line) => line.includes('resolves its landing'))).toEqual(['chain: ABC: the next task waits while ABC-1 resolves its landing'])
  })

  it('starts the next task with the setting off', async () => {
    const run = await widened({ task: 'ABC-1', rounds: 1, resolving: true }, false)
    expect(run.launched).toEqual(['ABC/ABC-2'])
  })

  it('does not hold on a landing that waits for the remote', async () => {
    const run = await widened({ task: 'ABC-1', rounds: 0, resolving: true, waitingRemote: true })
    expect(run.launched).toEqual(['ABC/ABC-2'])
  })
})

const waitingRemote: Landing = { task: 'ABC-1', rounds: 0, waitingRemote: true, failures: 3, retryAt: '2099-01-01T00:00:00.000Z' }
const unreachable: LandOutcome = { state: 'failed', transient: 'network', failure: notice('sync.fetch', { remote: 'origin' }, { detail: 'Could not resolve host' }) }

function closer(refuse = false) {
  const completed: { task: string; comment: string }[] = []
  const deps: UnchangedDeps = {
    changes: async () => ({ ahead: 0, files: 0 }),
    complete: async (_project, task, comment) => {
      if (refuse) throw new Error('tracker is down')
      completed.push({ task, comment })
    },
    accept: async () => undefined,
  }
  return { deps, completed }
}

async function waiting(landing: Landing, unchanged: UnchangedDeps) {
  const run = setup({
    state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }], landings: { ABC: [landing] } },
    live: { 'ABC-1': 'old-session' },
    land: async () => unreachable,
    unchanged,
  })
  run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await run.dispatcher.idle()
  return run
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (error: unknown) => error)
  expect(error).toBeInstanceOf(NoticeError)
  return (error as NoticeError).notice
}

describe('Dispatcher.closeUnpushed: "Close without pushing" (BTN-1582)', () => {
  it('moves the task waiting for the remote to done with the comment, then the chain cleans up and goes on', async () => {
    const { deps, completed } = closer()
    const run = await waiting(waitingRemote, deps)
    expect(run.launched).toEqual([])

    run.tracker.ABC = [task('ABC-1', done), task('ABC-2')]
    await run.dispatcher.closeUnpushed('ABC', 'ABC-1')
    await run.dispatcher.idle()
    await run.dispatcher.idle()

    expect(completed).toEqual([{ task: 'ABC-1', comment: PROMPTS.ru.landing.unpushed('main') }])
    expect(run.finished).toEqual(['ABC/ABC-1'])
    expect(run.launched).toEqual(['ABC/ABC-2'])
    expect(run.dispatcher.state.landings.ABC).toBeUndefined()
    expect(run.relays).toEqual([])
  })

  it('refuses a task whose landing does not wait for the remote, touching nothing', async () => {
    const { deps, completed } = closer()
    const run = await waiting({ task: 'ABC-1', rounds: 1, resolving: true }, deps)
    expect(await refusal(run.dispatcher.closeUnpushed('ABC', 'ABC-1'))).toMatchObject({ code: 'landing.notWaiting', params: { task: 'ABC-1' } })
    expect(await refusal(run.dispatcher.closeUnpushed('ABC', 'ABC-2'))).toMatchObject({ code: 'landing.notWaiting' })
    expect(completed).toEqual([])
  })

  it('says the tracker refused the move, the task staying current and waiting', async () => {
    const { deps } = closer(true)
    const run = await waiting(waitingRemote, deps)
    expect(await refusal(run.dispatcher.closeUnpushed('ABC', 'ABC-1'))).toMatchObject({ code: 'landing.notClosed', params: { task: 'ABC-1' } })
    expect(run.dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1' }, paused: false })
    expect(run.dispatcher.state.landings.ABC).toEqual([waitingRemote])
  })
})
