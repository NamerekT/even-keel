import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import type { StatusCategory, Task } from '../../src/tracker/model.js'
import type { EvenKeelState } from '../../src/state.js'
import { sinceWritten, unaccounted } from './changelog.js'

function task(id: string, category: StatusCategory, milestone: string | null = 'v0.1'): Task {
  return fakeTask(id, { status: { name: category, category }, milestone: milestone === null ? null : { label: milestone, targetDate: null } })
}

const TASKS = [
  task('ABC-1', 'Won'),
  task('ABC-2', 'Won'),
  task('ABC-3', 'Lost'),
  task('ABC-4', 'Active'),
  task('ABC-5', 'Won', 'v0.2'),
  task('ABC-6', 'Won', null),
  task('XYZ-1', 'Won'),
]

describe('unaccounted', () => {
  it("lists the milestone's done tasks of the project the version does not account for", () => {
    expect(unaccounted(TASKS, 'ABC', 'v0.1', ['ABC-1'])).toEqual(['ABC-2'])
  })

  it('is empty when every done task is accounted for', () => {
    expect(unaccounted(TASKS, 'ABC', 'v0.1', ['ABC-2', 'ABC-1'])).toEqual([])
  })
})

describe('sinceWritten', () => {
  const state = (changelogs: EvenKeelState['changelogs']) => ({ tasks: TASKS, changelogs })

  it('counts the done tasks closed after the last written version', () => {
    expect(sinceWritten(state({ ABC: { 'v0.1': ['ABC-1'] } }), 'ABC', 'v0.1')).toBe(1)
  })

  it('is null without a written version', () => {
    expect(sinceWritten(state({ ABC: { 'v0.2': ['ABC-5'] } }), 'ABC', 'v0.1')).toBeNull()
    expect(sinceWritten(state({}), 'ABC', 'v0.1')).toBeNull()
  })
})
