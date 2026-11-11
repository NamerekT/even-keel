import { describe, expect, it } from 'vitest'
import { fail, notice } from '../notice/notice.js'
import { afterDone, failedRun, type fakeMain } from './maincheck.fixture.js'
import { RERUN_MS } from './maincheck.js'

const red = { state: 'red', failed: [{ kind: 'github', run: failedRun }] } as const
/** The same run ended anew after the rerun: same id, a later `stoppedAt`. */
const rerun = { ...failedRun, startedAt: '2026-09-26T12:05:00Z', stoppedAt: '2026-09-26T12:07:00Z' }

/** ABC-1 is done and pushed at `bbbbbbbbbb`; `ci.rerunFailed` is on. */
const rerunning = (prepare: (ci: ReturnType<typeof fakeMain>['ci']) => void = () => {}) =>
  afterDone(null, (ci) => {
    ci.rerunFailed = true
    prepare(ci)
  })

describe('MainCheck and the rerun of failed jobs (BTN-846)', () => {
  it('reruns the failed jobs on the first red and waits instead of fixing', async () => {
    const { dispatcher, launched, log, ci } = await rerunning()
    expect(dispatcher.main!.view('ABC').judging).toBe('bbbbbbbbbb')
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.reruns).toEqual([red.failed])
    expect(ci.created).toEqual([])
    expect(ci.reports).toEqual([])
    expect(dispatcher.state.ci.ABC?.check?.commit).toBe('bbbbbbbbbb')
    expect(dispatcher.state.ci.ABC?.rerun).toEqual({ commit: 'bbbbbbbbbb', at: '2026-09-26T12:00:00.000Z', runs: ['7:2026-09-26T12:02:00Z'] })
    expect(dispatcher.main!.view('ABC').judging).toBe('bbbbbbbbbb')
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(ci.looks).toContain('ABC')
    expect(ci.events.map((event) => event.notice)).toEqual([notice('eventLog.ciRerun', { project: 'ABC', commit: 'bbbbbbb', cis: ['github'] })])
    expect(log).toContain('ci: ABC: bbbbbbb is red; its failed jobs are rerun once before a fix')

    // The old red is still what the CI shows until the run ends anew.
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.reruns).toHaveLength(1)
    expect(ci.created).toEqual([])
    expect(dispatcher.state.ci.ABC?.check?.commit).toBe('bbbbbbbbbb')
  })

  it('takes a green rerun for green: nothing is fixed and the chain goes on', async () => {
    const { dispatcher, launched, ci } = await rerunning()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toEqual([])
    expect(dispatcher.state.ci.ABC?.green).toBe('bbbbbbbbbb')
    expect(dispatcher.state.ci.ABC?.check).toBeUndefined()
    expect(dispatcher.main!.view('ABC').judging).toBeUndefined()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(ci.events.at(-1)?.notice).toEqual(notice('eventLog.ciRerunGreen', { project: 'ABC', commit: 'bbbbbbb' }))
  })

  it('fixes a red rerun as before and tells the fix it was rerun', async () => {
    const { dispatcher, ci } = await rerunning()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    ci.verdict = { state: 'red', failed: [{ kind: 'github', run: rerun }] }
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.reruns).toHaveLength(1)
    expect(ci.created).toHaveLength(1)
    expect(dispatcher.main!.view('ABC').judging).toBeUndefined()
    expect(ci.reports[0]?.failure).toEqual({ ci: [{ kind: 'github', run: rerun }], reran: true })
    expect(ci.events.at(-1)?.notice).toEqual(notice('eventLog.ciRerunRed', { project: 'ABC', commit: 'bbbbbbb' }))
  })

  it('tells a session fix without a task that the jobs were rerun', async () => {
    const { dispatcher, ci, fixes } = await rerunning((each) => {
      each.fixTask = false
    })
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    ci.verdict = { state: 'red', failed: [{ kind: 'github', run: rerun }] }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.fix).toMatchObject({ task: 'ABC-FIX', commit: 'bbbbbbbbbb', reran: true })
    expect(fixes).toEqual([{ project: 'ABC', name: 'ABC-FIX', report: 'fix main: log', reran: true }])
  })

  it('does not rerun a commit twice, even after a restart', async () => {
    const { dispatcher, ci } = await rerunning((each) => {
      each.verdict = red
    })
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.reruns).toHaveLength(1)
    // What a restart reads back: the rerun of this commit is in the gate.
    expect(structuredClone(dispatcher.state.ci.ABC?.rerun)?.commit).toBe('bbbbbbbbbb')
    ci.verdict = { state: 'red', failed: [{ kind: 'github', run: rerun }] }
    dispatcher.check()
    await dispatcher.idle()
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.reruns).toHaveLength(1)
  })

  it('fixes at once with the setting off', async () => {
    const { dispatcher, ci } = await rerunning((each) => {
      each.rerunFailed = false
    })
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.reruns).toEqual([])
    expect(ci.created).toHaveLength(1)
    expect(ci.reports[0]?.failure).toEqual({ ci: red.failed })
    expect(dispatcher.main!.view('ABC').judging).toBeUndefined()
  })

  it('fixes at once when the CI cannot rerun, with only a log line', async () => {
    const { dispatcher, log, ci } = await rerunning((each) => {
      each.rerunError = fail('ci.rerunUnsupported', { ci: 'Forgejo' })
    })
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toHaveLength(1)
    expect(dispatcher.state.ci.ABC?.rerun).toBeUndefined()
    expect(dispatcher.main!.view('ABC').judging).toBeUndefined()
    expect(ci.events).toEqual([])
    expect(log.some((line) => line.startsWith('ci: ABC: bbbbbbb is red; its failed jobs were not rerun:'))).toBe(true)
  })

  it('fixes at once and warns when the token may not rerun', async () => {
    const { dispatcher, ci } = await rerunning((each) => {
      each.rerunError = fail('ci.rerunDenied', { ci: 'GitHub Actions', status: 403 })
    })
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toHaveLength(1)
    expect(ci.events).toHaveLength(1)
    expect(ci.events[0]).toMatchObject({ level: 'warning', place: { view: 'settings', project: null } })
    expect(ci.events[0]?.notice.code).toBe('eventLog.ciRerunFailed')
    expect(dispatcher.main!.view('ABC').judging).toBeUndefined()
  })

  it('lets the old red decide once RERUN_MS runs out', async () => {
    const { dispatcher, clock, ci } = await rerunning()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    clock.now = new Date(clock.now.getTime() + RERUN_MS - 1)
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toEqual([])
    clock.now = new Date(clock.now.getTime() + 1)
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toHaveLength(1)
    expect(ci.reports[0]?.failure).toEqual({ ci: red.failed, reran: true })
  })

  it('waits while the CI cannot say during the rerun', async () => {
    const { dispatcher, ci } = await rerunning()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    ci.verdict = { state: 'unavailable', reasons: [notice('ci.notTaken', { ci: 'GitHub Actions', commit: 'bbbbbbb' })] }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.check?.commit).toBe('bbbbbbbbbb')
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.green).toBe('bbbbbbbbbb')
  })
})
