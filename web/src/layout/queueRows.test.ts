import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../../src/tracker/fixture.js'
import type { EvenKeelState } from '../../../src/state.js'
import { activeProjects, chainKind, queueRows } from './queueRows.js'

const lane = (project: string, task: string | null, machine?: string, paused = false) => ({
  project, ...(machine !== undefined && { machine }), current: task === null ? null : { task, sessionId: null, since: '' }, paused, error: null,
})

const state = (active: ReturnType<typeof lane>[]) =>
  ({
    tasks: ['ABC-1', 'ABC-2', 'ABC-3', 'XYZ-1'].map((id) => ({ ...fakeTask(id, { title: `Title ${id}` }), project: id.split('-')[0] })),
    sessions: [],
    taskSessions: {},
    fixes: {},
    works: {},
    trackers: [],
    feeds: {},
    projects: ['ABC', 'XYZ'],
    taskPrefixes: { ABC: 'ABC', XYZ: 'XYZ' },
    chain: {
      active, queue: [], parallel: 3, skipped: {}, leftovers: {},
      projects: { ABC: { order: ['ABC-1', 'ABC-2', 'ABC-3'], waiting: [], backlog: [], error: null }, XYZ: { order: ['XYZ-1'], waiting: [], backlog: [], error: null } },
    },
  }) as unknown as EvenKeelState

describe('queueRows', () => {
  it('gives two lanes of one project one row with each lane’s own task', () => {
    const view = state([lane('ABC', 'ABC-1', 'srv'), lane('ABC', 'ABC-2', 'pc')])
    expect(activeProjects(view.chain)).toEqual(['ABC'])
    const rows = queueRows(view)
    expect(rows.map((row) => row.project)).toEqual(['ABC'])
    expect(rows[0]!.tasks.map((task) => task.id)).toEqual(['ABC-1', 'ABC-2'])
  })

  it('shows the next task once for a project whose lanes hold none', () => {
    const rows = queueRows(state([lane('ABC', null, 'srv'), lane('ABC', null, 'pc'), lane('XYZ', 'XYZ-1')]))
    expect(rows.map((row) => [row.project, row.tasks.map((task) => task.id)])).toEqual([['ABC', ['ABC-1']], ['XYZ', ['XYZ-1']]])
  })

  it('skips an idle lane next to one holding a task', () => {
    const rows = queueRows(state([lane('ABC', null, 'srv'), lane('ABC', 'ABC-3', 'pc')]))
    expect(rows[0]!.tasks.map((task) => task.id)).toEqual(['ABC-3'])
  })
})

describe('chainKind', () => {
  it('is paused only when every lane is', () => {
    expect(chainKind(state([]).chain)).toBe('idle')
    expect(chainKind(state([lane('ABC', 'ABC-1', 'srv', true), lane('ABC', 'ABC-2', 'pc')]).chain)).toBe('running')
    expect(chainKind(state([lane('ABC', 'ABC-1', 'srv', true)]).chain)).toBe('paused')
  })
})
