import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import type { StatusCategory } from '../../src/tracker/model.js'
import type { EvenKeelState, ProjectTask } from '../../src/state.js'
import { sinceWritten, unaccounted } from './changelog.js'

/** A task of `id-abc` or `id-xyz`, the project its prefix names. */
function task(id: string, category: StatusCategory, milestone: string | null = 'v0.1'): ProjectTask {
  const project = `id-${id.split('-')[0]!.toLowerCase()}`
  return { project, ...fakeTask(id, { status: { name: category, category }, milestone: milestone === null ? null : { label: milestone, targetDate: null } }) }
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
    expect(unaccounted(TASKS, 'id-abc', 'v0.1', ['ABC-1'])).toEqual(['ABC-2'])
  })

  it('is empty when every done task is accounted for', () => {
    expect(unaccounted(TASKS, 'id-abc', 'v0.1', ['ABC-2', 'ABC-1'])).toEqual([])
  })
})

describe('sinceWritten', () => {
  const state = (changelogs: EvenKeelState['changelogs']) => ({ tasks: TASKS, changelogs })

  it('counts the done tasks closed after the last written version', () => {
    expect(sinceWritten(state({ 'id-abc': { 'v0.1': ['ABC-1'] } }), 'id-abc', 'v0.1')).toBe(1)
  })

  it('is null without a written version', () => {
    expect(sinceWritten(state({ 'id-abc': { 'v0.2': ['ABC-5'] } }), 'id-abc', 'v0.1')).toBeNull()
    expect(sinceWritten(state({}), 'id-abc', 'v0.1')).toBeNull()
  })
})
