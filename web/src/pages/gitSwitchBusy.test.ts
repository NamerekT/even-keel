import { describe, expect, it } from 'vitest'
import type { EvenKeelState, SessionView } from '../../../src/state.js'
import { gitSwitchBusy } from './gitSwitchBusy.js'

type Shape = Parameters<typeof gitSwitchBusy>[0]

function stateOf(change: { current?: string; sessions?: Partial<SessionView>[] } = {}): Shape {
  return {
    chain: {
      active: [{ project: 'p1', current: change.current === undefined ? null : { task: change.current, sessionId: null, since: '' }, paused: false, error: null }],
      parallel: 1,
      queue: [],
      projects: {},
      skipped: {},
      leftovers: {},
    },
    tasks: [{ id: 'ABC-1', project: 'p1' }] as EvenKeelState['tasks'],
    sessions: (change.sessions ?? []).map((each) => ({ task: 'X-1', cwd: 'C:\\elsewhere', lamp: 'waiting', ...each }) as SessionView),
    config: { projects: { p1: { repo: 'C:\\data\\projects\\abc' } } } as unknown as EvenKeelState['config'],
  }
}

describe('gitSwitchBusy', () => {
  it('lets a chain between tasks switch', () => {
    expect(gitSwitchBusy(stateOf(), 'p1')).toBe(false)
  })

  it('holds while the chain works on a task', () => {
    expect(gitSwitchBusy(stateOf({ current: 'ABC-1' }), 'p1')).toBe(true)
  })

  it('holds for a live session of a project task or in its folder, not for a finished one', () => {
    expect(gitSwitchBusy(stateOf({ sessions: [{ task: 'ABC-1' }] }), 'p1')).toBe(true)
    expect(gitSwitchBusy(stateOf({ sessions: [{ cwd: 'c:/data/projects/abc/' }] }), 'p1')).toBe(true)
    expect(gitSwitchBusy(stateOf({ sessions: [{ cwd: 'C:\\data\\projects\\abc-other' }] }), 'p1')).toBe(false)
    expect(gitSwitchBusy(stateOf({ sessions: [{ task: 'ABC-1', lamp: 'finished' }] }), 'p1')).toBe(false)
  })
})
