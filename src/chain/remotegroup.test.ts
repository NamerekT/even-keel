import { describe, expect, it } from 'vitest'
import type { Dispatcher } from './dispatcher.js'
import { done, setup, task } from './dispatcher.fixture.js'
import { failedRun, fakeMain } from './maincheck.fixture.js'

const red = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] } as const

/** ABC and XYZ are clones of one remote, both chains run; ABC-1 is done and pushed at `bbbbbbbbbb`. */
async function twoClones(fixTask: boolean) {
  const { ci, deps } = fakeMain()
  ci.fixTask = fixTask
  ci.peers = { ABC: ['XYZ'], XYZ: ['ABC'] }
  const harness = setup({ main: deps, parallel: 2, projects: ['ABC', 'XYZ'] })
  const { dispatcher } = harness
  dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  dispatcher.setTasks('XYZ', [task('XYZ-1'), task('XYZ-2')])
  dispatcher.start('ABC')
  dispatcher.start('XYZ')
  await dispatcher.idle()
  dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
  await dispatcher.idle()
  return { ...harness, ci }
}

/** XYZ-1 goes to Done, and the verdict on XYZ's push is asked for. */
async function xyzPushed(dispatcher: Dispatcher) {
  dispatcher.setTasks('XYZ', [task('XYZ-1', done), task('XYZ-2')])
  await dispatcher.idle()
  dispatcher.check()
  await dispatcher.idle()
}

describe('Dispatcher and projects of one remote', () => {
  it('holds every project of the remote on a red main and fixes it once, by the push of its author', async () => {
    const { dispatcher, launched, fixes, ci, log } = await twoClones(false)
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(fixes).toEqual([{ project: 'ABC', name: 'ABC-FIX', report: 'fix main: log' }])

    // XYZ-1 was already working and is not touched; its push carries ABC's red commit.
    await xyzPushed(dispatcher)
    expect(fixes).toHaveLength(1)
    expect(dispatcher.state.ci.XYZ?.fix).toBeUndefined()
    expect(log).toContain('ci: XYZ: ccccccc is red; ABC-FIX of ABC is already fixing main of the remote')
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1', 'ABC/ABC-FIX'])
    const xyz = () => dispatcher.state.active.find((chain) => chain.project === 'XYZ')
    expect(xyz()?.ciWait).toEqual({ commit: 'bbbbbbbbbb', since: '2026-09-26T12:00:00.000Z', by: 'ABC' })

    // The fix lands: its push is awaited, and the hold stays until it is green.
    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.check?.tasks).toEqual(['ABC-FIX'])
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1', 'ABC/ABC-FIX'])
    expect(xyz()?.ciWait?.by).toBe('ABC')

    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1', 'ABC/ABC-FIX', 'ABC/ABC-2', 'XYZ/XYZ-2'])
    expect(xyz()?.ciWait).toBeUndefined()
  })

  it('files no second fix task while the author’s is open, and lets go once its push is green', async () => {
    const { dispatcher, launched, ci } = await twoClones(true)
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toHaveLength(1)
    dispatcher.setTasks('ABC', [task('ABC-2'), task('ABC-9')])
    await xyzPushed(dispatcher)
    expect(ci.created).toHaveLength(1)
    expect(dispatcher.state.ci.XYZ?.fix).toBeUndefined()
    expect(launched).not.toContain('XYZ/XYZ-2')

    ci.verdict = { state: 'green' }
    dispatcher.setTasks('ABC', [task('ABC-2'), task('ABC-9', done)])
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.check?.tasks).toEqual(['ABC-9'])
    expect(launched).not.toContain('XYZ/XYZ-2')
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toContain('XYZ/XYZ-2')
  })

  it('is not held by a fix task the tracker no longer lists and has no push awaited', async () => {
    const { dispatcher, launched, ci } = await twoClones(true)
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-2')])
    ci.verdict = { state: 'green' }
    await xyzPushed(dispatcher)
    expect(launched).toContain('XYZ/XYZ-2')
    expect(dispatcher.state.active.find((chain) => chain.project === 'XYZ')?.ciWait).toBeUndefined()
  })

  it('does not hold a project of another remote', async () => {
    const { dispatcher, launched, ci } = await twoClones(false)
    ci.peers = {}
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    await xyzPushed(dispatcher)
    expect(dispatcher.state.ci.XYZ?.fix?.task).toBe('XYZ-FIX')
    expect(launched).toContain('XYZ/XYZ-FIX')
  })
})
