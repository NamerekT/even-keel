import { describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { homeBlocks } from './homeGroups.js'
import { homeTests } from './homeTests.js'

function state(show: boolean, tests: string[], demo: string | null = null) {
  const projects = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, { testProject: tests.includes(id) }]))
  return { showTests: { home: show, stats: false }, config: { projects }, demo: demo === null ? null : { project: demo } } as unknown as EvenKeelState
}

describe('homeTests', () => {
  it('hides the test projects while the switch is off and counts them', () => {
    expect(homeTests(state(false, ['b', 'd']), ['a', 'b', 'c', 'd'])).toEqual({ tests: ['b', 'd'], hidden: 2, visible: ['a', 'c'] })
  })

  it('shows every project while the switch is on, the tests still known for the switch', () => {
    expect(homeTests(state(true, ['b']), ['a', 'b', 'c'])).toEqual({ tests: ['b'], hidden: 0, visible: ['a', 'b', 'c'] })
  })

  it('counts only the projects of the view it is given, as a machine filter leaves them', () => {
    expect(homeTests(state(false, ['b', 'd']), ['a', 'b'])).toEqual({ tests: ['b'], hidden: 1, visible: ['a'] })
  })

  it('never hides the demo project, though it is a test one', () => {
    expect(homeTests(state(false, ['b', 'c'], 'c'), ['a', 'b', 'c'])).toEqual({ tests: ['b'], hidden: 1, visible: ['a', 'c'] })
  })

  it('leaves out a group whose projects are all hidden and counts only the visible ones in the others', () => {
    const remotes = { a: [{ id: 'one' }], b: [{ id: 'one' }], c: [{ id: 'two' }], d: [{ id: 'two' }] }
    const { visible } = homeTests(state(false, ['b', 'c', 'd']), ['a', 'b', 'c', 'd'])
    expect(homeBlocks('remote', visible, { remotes, trackers: [] } as never)).toEqual([{ title: null, sections: [{ title: null, projects: ['a'] }] }])
  })
})
