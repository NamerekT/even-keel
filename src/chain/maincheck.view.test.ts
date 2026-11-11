import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import { setup } from './dispatcher.fixture.js'
import { afterDone, fakeMain } from './maincheck.fixture.js'
import type { AfterGreenRun } from './model.js'

const NOW = '2026-09-26T12:00:00.000Z'

function held() {
  let end: (run: AfterGreenRun) => void = () => {}
  const run = new Promise<AfterGreenRun>((resolve) => (end = resolve))
  return { run, end }
}

async function settled(dispatcher: { idle(): Promise<void> }): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await dispatcher.idle()
}

describe('MainCheck.view: what the CI panel shows of main (BTN-829)', () => {
  it('keeps a restored push quiet until its verdict, but not a completed rerun mark', () => {
    const { deps } = fakeMain(0)
    const { dispatcher } = setup({ main: deps })
    const rerun = { commit: 'bbbbbbbbbb', at: NOW, runs: ['7:2026-09-26T12:02:00Z'] }
    dispatcher.state.ci.ABC = { check: { commit: rerun.commit, at: NOW, tasks: ['ABC-1'] }, rerun }
    expect(dispatcher.main!.view('ABC').judging).toBe(rerun.commit)
    delete dispatcher.state.ci.ABC.check
    expect(dispatcher.main!.view('ABC').judging).toBeUndefined()
  })

  it('shows the commands after a green main going on, then done, and keeps their start and end in the state', async () => {
    const after = held()
    const { dispatcher, ci } = await afterDone(null, (ci) => {
      ci.afterGreen = true
      ci.afterRuns = { bbbbbbbbbb: after.run }
    })
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.main!.view('ABC').afterGreen).toEqual({ commit: 'bbbbbbbbbb', since: NOW, running: true })
    expect(dispatcher.state.ci.ABC?.afterGreenRun).toEqual({ commit: 'bbbbbbbbbb', since: NOW })

    after.end({ state: 'done' })
    await settled(dispatcher)
    expect(dispatcher.main!.view('ABC').afterGreen).toEqual({ commit: 'bbbbbbbbbb', since: NOW, end: { at: NOW, state: 'done' }, running: false })
    expect(dispatcher.state.ci.ABC?.afterGreenRun?.end).toEqual({ at: NOW, state: 'done' })
  })

  it('keeps the failed command and its code, not its output', async () => {
    const { dispatcher, ci } = await afterDone(null, (ci) => {
      ci.afterGreen = true
      ci.afterRuns = { bbbbbbbbbb: { state: 'failed', failure: { command: 'npm run build', code: 2, output: 'error TS2304' } } }
    })
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await settled(dispatcher)
    expect(dispatcher.state.ci.ABC?.afterGreenRun?.end).toEqual({ at: NOW, state: 'failed', command: 'npm run build', code: 2 })
  })

  it('keeps why a run was skipped', async () => {
    const reason = notice('afterGreen.offBranch', { branch: 'main', on: 'dev' })
    const { dispatcher, log, ci } = await afterDone(null, (ci) => {
      ci.afterGreen = true
      ci.afterRuns = { bbbbbbbbbb: { state: 'skipped', reason } }
    })
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await settled(dispatcher)
    expect(dispatcher.state.ci.ABC?.afterGreenRun?.end).toEqual({ at: NOW, state: 'skipped', reason })
    expect(log).toContain('afterGreen: ABC: skipped after bbbbbbb: the main checkout is on dev, not on main')
  })

  it('shows a run from before a restart as not going on, its end unseen', () => {
    const { ci, deps } = fakeMain(0)
    ci.afterGreen = true
    const { dispatcher } = setup({ main: deps })
    dispatcher.state.ci.ABC = { green: 'eeeeeeeeee', afterGreen: 'eeeeeeeeee', afterGreenRun: { commit: 'eeeeeeeeee', since: '2026-09-26T11:50:00Z' } }
    expect(dispatcher.main!.view('ABC').afterGreen).toEqual({ commit: 'eeeeeeeeee', since: '2026-09-26T11:50:00Z', running: false })
  })

  it('shows no commands for a project that has none now', () => {
    const { deps } = fakeMain(0)
    const { dispatcher } = setup({ main: deps })
    dispatcher.state.ci.ABC = { afterGreenRun: { commit: 'eeeeeeeeee', since: '2026-09-26T11:50:00Z' } }
    expect(dispatcher.main!.view('ABC')).toEqual({ pushes: {} })
  })

  it('names the chain for its own push and a hand for a push from outside', async () => {
    const { dispatcher, ci } = await afterDone(null, (ci) => {
      ci.remote = { ABC: 'aaaaaaaaaa' }
    })
    expect(dispatcher.main!.view('ABC').pushes).toEqual({ bbbbbbbbbb: 'chain' })
    dispatcher.check()
    await dispatcher.idle()
    ci.remote.ABC = 'ffffffffff'
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.main!.view('ABC').pushes).toEqual({ bbbbbbbbbb: 'chain', ffffffffff: 'hand' })
  })

  it('shows the late watch of a push no runner took, until it ends', async () => {
    const { dispatcher, ci } = await afterDone()
    ci.verdict = { state: 'unavailable', reasons: [notice('ci.notTaken', { ci: 'Forgejo', commit: 'bbbbbbb' })] }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.main!.view('ABC').late).toEqual({ commit: 'bbbbbbbbbb', until: '2026-09-26T13:00:00.000Z' })
    expect(dispatcher.main!.view('ABC').judging).toBe('bbbbbbbbbb')

    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.main!.view('ABC').late).toBeUndefined()
    expect(dispatcher.main!.view('ABC').judging).toBeUndefined()
  })
})
