import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import { done, task } from './dispatcher.fixture.js'
import { afterDone } from './maincheck.fixture.js'
import type { CheckFailure } from './model.js'

const failure: CheckFailure = { command: 'npm test', code: 1, output: 'FAIL src/a.test.ts' }

describe('Dispatcher and the project check of main', () => {
  it('checks nothing when the project has no check commands', async () => {
    const { dispatcher, launched, ci } = await afterDone(null, (ci) => {
      ci.verdict = { state: 'none' }
    })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(ci.checked).toEqual([])
    expect(dispatcher.state.ci.ABC).toEqual({})
  })

  it('trusts the check before the merge when main has the tree of the task branch', async () => {
    const { dispatcher, launched, log, ci } = await afterDone(null, (ci) => {
      ci.verdict = { state: 'none' }
      ci.commands = ['npm test']
      ci.taskTrees = { 'ABC-1': 'tree-bbbbbbbbbb' }
    })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(ci.checked).toEqual([])
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'bbbbbbbbbb' })
    expect(log).toContain('ci: ABC: bbbbbbb is the tree the check passed before the merge')
  })

  it('runs the check on a moved main in the next task place before launching it', async () => {
    const { dispatcher, launched, saved, ci } = await afterDone(null, (ci) => {
      ci.verdict = { state: 'none' }
      ci.commands = ['npm test']
      ci.taskTrees = { 'ABC-1': 'tree-of-the-branch' }
    })
    expect(ci.checked).toEqual(['ABC/ABC-2@bbbbbbbbbb'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'bbbbbbbbbb' })
    expect(saved.some((state) => state.active[0]?.ciWait?.local === true)).toBe(true)
    expect(dispatcher.state.active[0]?.ciWait).toBeUndefined()
  })

  it('leaves a moved main unchecked when the check of main is off', async () => {
    const { dispatcher, launched, log, ci } = await afterDone(null, (ci) => {
      ci.verdict = { state: 'none' }
      ci.commands = ['npm test']
      ci.recheck = false
    })
    expect(ci.checked).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.ci.ABC).toEqual({})
    expect(log).toContain('ci: ABC: bbbbbbb stays unchecked: main moved past the checked branch, and the check of main is off')
  })

  it('takes over a push the CI cannot judge', async () => {
    const { dispatcher, launched, log, ci } = await afterDone(null, (ci) => {
      ci.commands = ['npm test']
    })
    expect(launched).toEqual(['ABC/ABC-1'])

    ci.verdict = { state: 'unavailable', reasons: [notice('ci.notTaken', { ci: 'Forgejo', commit: 'bbbbbbb' })] }
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.checked).toEqual(['ABC/ABC-2@bbbbbbbbbb'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(log).toContain("ci: ABC: the CI cannot judge bbbbbbb (Forgejo: no runner took bbbbbbb); the project's check takes it")
  })

  it('files a fix task when the check fails on main, starts it first and stops on a failed fix', async () => {
    const { dispatcher, launched, ci } = await afterDone(null, (ci) => {
      ci.verdict = { state: 'none' }
      ci.commands = ['npm test']
      ci.runs = { bbbbbbbbbb: { state: 'red', failure }, cccccccccc: { state: 'red', failure } }
    })
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(ci.reports).toEqual([{ push: { commit: 'bbbbbbbbbb', at: '2026-09-26T12:00:00.000Z', tasks: ['ABC-1'] }, failure: { check: failure }, green: null }])
    expect(ci.created).toHaveLength(1)
    expect(dispatcher.state.ci.ABC?.fix?.task).toBe('ABC-9')

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3'), task('ABC-9')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-9'])

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3'), task('ABC-9', done)])
    await dispatcher.idle()
    expect(ci.checked).toEqual(['ABC/ABC-2@bbbbbbbbbb', 'ABC/ABC-2@cccccccccc'])
    expect(ci.created).toHaveLength(1)
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-9'])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: notice('check.fixFailed', { task: 'ABC-9', commit: 'ccccccc' }) })
  })
})
