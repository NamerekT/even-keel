import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import { done, setup, task } from './dispatcher.fixture.js'
import { afterDone, fakeMain } from './maincheck.fixture.js'
import type { AfterGreenRun } from './model.js'

function held() {
  let end: (run: AfterGreenRun) => void = () => {}
  const run = new Promise<AfterGreenRun>((resolve) => (end = resolve))
  return { run, end }
}

/** Lets the end of a run reach the dispatcher and its next step finish. */
async function settled(dispatcher: { idle(): Promise<void> }): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await dispatcher.idle()
}

describe('Dispatcher and the commands after a green main', () => {
  it('runs them once on the green verdict, marks the commit first and holds the next launch until they end', async () => {
    const after = held()
    const { dispatcher, launched, saved, log, ci } = await afterDone(null, (ci) => {
      ci.afterGreen = true
      ci.afterRuns = { bbbbbbbbbb: after.run }
    })
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()

    expect(ci.ran).toEqual(['ABC@bbbbbbbbbb'])
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'bbbbbbbbbb', afterGreen: 'bbbbbbbbbb' })
    expect(saved.some((state) => state.ci.ABC?.afterGreen === 'bbbbbbbbbb' && state.active[0]?.ciWait?.after !== true)).toBe(true)
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]?.ciWait).toEqual({ commit: 'bbbbbbbbbb', since: '2026-09-26T12:00:00.000Z', after: true })

    after.end({ state: 'done' })
    await settled(dispatcher)
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active[0]?.ciWait).toBeUndefined()
    expect(log).toContain('afterGreen: ABC: the commands after bbbbbbb are done')

    dispatcher.check()
    await dispatcher.idle()
    expect(ci.ran).toEqual(['ABC@bbbbbbbbbb'])
  })

  it('runs nothing for a project without them', async () => {
    const { dispatcher, launched, ci } = await afterDone(null, (ci) => {
      ci.verdict = { state: 'green' }
    })
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.ran).toEqual([])
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'bbbbbbbbbb' })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('runs them on a main the project check passed', async () => {
    const { dispatcher, launched, ci } = await afterDone(null, (ci) => {
      ci.verdict = { state: 'none' }
      ci.commands = ['npm test']
      ci.taskTrees = { 'ABC-1': 'tree-bbbbbbbbbb' }
      ci.afterGreen = true
    })
    await settled(dispatcher)
    expect(ci.ran).toEqual(['ABC@bbbbbbbbbb'])
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'bbbbbbbbbb', afterGreen: 'bbbbbbbbbb' })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('does not run them again for the commit they were started on before a restart', async () => {
    const { ci, deps } = fakeMain(0)
    ci.afterGreen = true
    const { dispatcher } = setup({ main: deps })
    dispatcher.state.ci.ABC = { check: { commit: 'eeeeeeeeee', at: '2026-09-26T11:59:00Z', tasks: ['ABC-1'] }, afterGreen: 'eeeeeeeeee' }
    ci.verdict = { state: 'green' }
    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()
    expect(ci.ran).toEqual([])
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'eeeeeeeeee', afterGreen: 'eeeeeeeeee' })
  })

  it('warns on the page and goes on when a command fails, without a fix', async () => {
    const failure = { command: 'npm run build', code: 2, output: 'error TS2304' }
    const { dispatcher, launched, log, ci } = await afterDone(null, (ci) => {
      ci.afterGreen = true
      ci.afterRuns = { bbbbbbbbbb: { state: 'failed', failure } }
    })
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await settled(dispatcher)

    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active[0]?.paused).toBe(false)
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'bbbbbbbbbb', afterGreen: 'bbbbbbbbbb' })
    expect(ci.created).toEqual([])
    expect(dispatcher.state.leftovers.ABC).toEqual([
      { task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', notice: notice('afterGreen.failed', { command: 'npm run build', code: 2, commit: 'bbbbbbb' }) },
    ])
    expect(log).toContain('afterGreen: ABC: npm run build after bbbbbbb exited with 2')
  })

  it('logs a run skipped because the checkout is elsewhere', async () => {
    const { dispatcher, launched, log, ci } = await afterDone(null, (ci) => {
      ci.afterGreen = true
      ci.afterRuns = { bbbbbbbbbb: { state: 'skipped', reason: 'the checkout is on dev' } }
    })
    ci.verdict = { state: 'green' }
    dispatcher.check()
    await settled(dispatcher)
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.leftovers.ABC).toBeUndefined()
    expect(log).toContain('afterGreen: ABC: skipped after bbbbbbb: the checkout is on dev')
  })

  it('runs the commands of a later green main after the running ones end', async () => {
    const first = held()
    const { ci, deps } = fakeMain(0)
    ci.afterGreen = true
    ci.afterRuns = { bbbbbbbbbb: first.run }
    ci.verdict = { state: 'green' }
    const { dispatcher } = setup({ main: deps })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.ran).toEqual(['ABC@bbbbbbbbbb'])

    dispatcher.state.ci.ABC!.check = { commit: 'cccccccccc', at: '2026-09-26T12:00:00Z', tasks: ['ABC-2'] }
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.ran).toEqual(['ABC@bbbbbbbbbb'])

    first.end({ state: 'done' })
    await settled(dispatcher)
    expect(ci.ran).toEqual(['ABC@bbbbbbbbbb', 'ABC@cccccccccc'])
    expect(dispatcher.state.ci.ABC?.afterGreen).toBe('cccccccccc')
  })
})
