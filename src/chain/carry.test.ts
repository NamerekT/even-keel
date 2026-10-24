import { describe, expect, it } from 'vitest'
import { done, setup, task } from './dispatcher.fixture.js'
import type { CarrySession } from './model.js'

/** XYZ is a release project merging into ABC; git could not merge two of its commits. */
const carryOf = (at = '2026-09-26T12:00:00.000Z'): CarrySession => ({
  task: 'XYZ-CARRY',
  into: 'ABC',
  at,
  commit: 'rrrrrrrrrr',
  commits: 2,
  report: 'carry XYZ: a.ts conflicts',
})

describe('Dispatcher and the carry of a release project resolved by a session (BTN-369)', () => {
  it('runs the carry after the current task, then goes on with the tasks', async () => {
    const harness = setup()
    const { dispatcher, launched, carries, busy, finished, journal, carried } = harness
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    busy.add('ABC-1')
    dispatcher.carry('XYZ', carryOf())
    await dispatcher.idle()
    expect(dispatcher.state.ci.XYZ?.carry).toEqual(carryOf())
    expect(launched).toEqual(['ABC/ABC-1'])

    busy.delete('ABC-1')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(carries).toEqual([{ project: 'ABC', name: 'XYZ-CARRY', report: 'carry XYZ: a.ts conflicts' }])
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'XYZ-CARRY', sessionId: 'session-2' })
    expect(journal.at(-1)).toMatchObject({ project: 'ABC', task: 'XYZ-CARRY', sessionId: 'session-2', commit: 'rrrrrrrrrr' })
    expect(dispatcher.held('ABC')).toEqual([])

    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.current?.task).toBe('XYZ-CARRY')

    carried.add('ABC/rrrrrrrrrr')
    busy.add('XYZ-CARRY')
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.current?.task).toBe('XYZ-CARRY')

    busy.delete('XYZ-CARRY')
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1', 'ABC/XYZ-CARRY'])
    expect(journal.find((entry) => entry.reason === 'carried')).toMatchObject({ project: 'ABC', task: 'XYZ-CARRY', sessionId: 'session-2', commits: 2 })
    expect(dispatcher.state.ci.XYZ?.carry).toBeUndefined()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/XYZ-CARRY', 'ABC/ABC-2'])
    expect(dispatcher.state.released).toEqual({})
  })

  it('starts a chain only for the carry when the project has none, and ends it with the carry', async () => {
    const { dispatcher, launched, carried } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.carry('XYZ', carryOf())
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/XYZ-CARRY'])
    expect(dispatcher.state.active[0]).toMatchObject({ project: 'ABC', fixOnly: true })

    carried.add('ABC/rrrrrrrrrr')
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(launched).toEqual(['ABC/XYZ-CARRY'])
  })

  it('keeps the carry asked first while it lasts', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [])
    dispatcher.carry('XYZ', carryOf())
    dispatcher.carry('XYZ', { ...carryOf(), report: 'again' })
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/XYZ-CARRY'])
    expect(dispatcher.state.ci.XYZ?.carry?.report).toBe('carry XYZ: a.ts conflicts')
  })

  it('"Skip" drops the carry and leaves its session alone', async () => {
    const { dispatcher, busy, stopped, journal, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.carry('XYZ', carryOf())
    await dispatcher.idle()
    busy.add('XYZ-CARRY')
    expect(() => dispatcher.skip('ABC', 'XYZ-CARRY')).toThrow()

    busy.delete('XYZ-CARRY')
    dispatcher.skip('ABC', 'XYZ-CARRY')
    await dispatcher.idle()
    expect(dispatcher.state.ci.XYZ?.carry).toBeUndefined()
    expect(journal.at(-1)).toMatchObject({ task: 'XYZ-CARRY', reason: 'dropped' })
    expect(stopped).toEqual([])
    expect(finished).toEqual([])
    expect(dispatcher.state.active).toEqual([])
  })

  it('"Skip" on a carry still waiting for the current task takes it back, with nothing to journal', async () => {
    const { dispatcher, busy, launched, journal } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    busy.add('ABC-1')
    dispatcher.carry('XYZ', carryOf())
    dispatcher.skip('ABC', 'XYZ-CARRY')
    expect(dispatcher.state.ci.XYZ?.carry).toBeUndefined()
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')
    expect(journal.some((entry) => entry.task === 'XYZ-CARRY')).toBe(false)
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('hands the report over again to the next session of the carry', async () => {
    const { dispatcher, handoffs, relays } = setup()
    dispatcher.setTasks('ABC', [])
    dispatcher.carry('XYZ', carryOf())
    await dispatcher.idle()
    handoffs['XYZ-CARRY'] = {
      sessionId: 'session-1',
      agentId: 'agent-1',
      account: 'global',
      cwd: '/repo/.claude/worktrees/xyz-carry',
      workdir: '/repo/.claude/worktrees/xyz-carry',
      branch: 'xyz-carry/task',
      transcript: null,
      lastReplyAt: null,
      recent: [],
      lastMessage: null,
      checkpoint: null,
    }
    dispatcher.restart('ABC', 'XYZ-CARRY')
    await dispatcher.idle()
    expect(relays.at(-1)?.prompt).toContain('carry XYZ: a.ts conflicts')
  })
})
