import { describe, expect, it } from 'vitest'
import { done, fakeMachines, setup, task } from './dispatcher.fixture.js'
import { afterDone, fakeMain, failedRun } from './maincheck.fixture.js'

describe('the CI of main with several machines (BTN-995)', () => {
  it('awaits the verdict on the commit the machine that pushed reported, not on the own main', async () => {
    const pushed = { commit: 'eeeeeeeeee', tree: 'tree-pushed' }
    const { dispatcher, ci } = await afterDone(null, (main) => (main.reportedTrees['ABC-1'] = 'tree-pushed'), {
      finish: () => ({ warnings: [], syncError: null, main: pushed, machine: 'pc' }),
    })
    expect(dispatcher.state.ci.ABC?.check).toMatchObject({ commit: 'eeeeeeeeee', tasks: ['ABC-1'] })
    expect(ci.checked).toEqual([])
  })

  it('holds a lane on another machine at a push not judged yet, and at a red one', async () => {
    const { ci, deps } = fakeMain()
    const { machines, bound } = fakeMachines({ own: 1, pc: 1 }, { width: { ABC: 2 } })
    const { dispatcher, launched } = setup({ main: deps, machines })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3'), task('ABC-4')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(bound['ABC-2']).toBe('pc')

    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done), task('ABC-3'), task('ABC-4')])
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.check?.tasks).toEqual(['ABC-2'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])

    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).not.toContain('ABC/ABC-3')
  })
})
