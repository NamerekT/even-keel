import { describe, expect, it } from 'vitest'
import type { TaskRun } from '../../../src/sessions/runs.js'
import type { Task } from '../../../src/tracker/model.js'
import { BACKLOG_PAGE, nextLimit, searchBacklog } from './backlogSearch.js'

const task = (id: string, title: string, milestone: string | null = null) =>
  ({ id, title, milestone: milestone === null ? null : { id: milestone, label: milestone } }) as Task
const ids = (tasks: Task[]) => tasks.map((one) => one.id)

const tasks = [
  task('BTN-12', 'Search field in the backlog', 'v0.3'),
  task('BTN-7', 'Logo: a smaller keel', 'v0.4'),
  task('BTN-120', 'Cline CLI as an agent'),
]
const runs: Record<string, TaskRun> = { 'BTN-7': { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' } }
const runOf = (id: string) => runs[id] ?? null

describe('searchBacklog', () => {
  it('keeps every task for an empty or blank query', () => {
    expect(ids(searchBacklog(tasks, '', runOf))).toEqual(['BTN-12', 'BTN-7', 'BTN-120'])
    expect(ids(searchBacklog(tasks, '   ', runOf))).toEqual(['BTN-12', 'BTN-7', 'BTN-120'])
  })

  it('finds by a part of the key', () => {
    expect(ids(searchBacklog(tasks, 'btn-12', runOf))).toEqual(['BTN-12', 'BTN-120'])
  })

  it('finds by the title, whatever the case', () => {
    expect(ids(searchBacklog(tasks, 'KEEL', runOf))).toEqual(['BTN-7'])
  })

  it('finds by the run the card set: provider, model and effort', () => {
    expect(ids(searchBacklog(tasks, 'codex', runOf))).toEqual(['BTN-7'])
    expect(ids(searchBacklog(tasks, '6.1-sol', runOf))).toEqual(['BTN-7'])
    expect(ids(searchBacklog(tasks, 'high', runOf))).toEqual(['BTN-7'])
  })

  it("finds by the milestone's name", () => {
    expect(ids(searchBacklog(tasks, 'v0.4', runOf))).toEqual(['BTN-7'])
  })

  it('wants every word of several somewhere in the task', () => {
    expect(ids(searchBacklog(tasks, 'backlog v0.3', runOf))).toEqual(['BTN-12'])
    expect(ids(searchBacklog(tasks, 'backlog v0.4', runOf))).toEqual([])
  })

  it('keeps the order it was given', () => {
    expect(ids(searchBacklog(tasks, 'btn', runOf))).toEqual(['BTN-12', 'BTN-7', 'BTN-120'])
  })
})

describe('nextLimit', () => {
  it('shows the first page, then adds one page at a time up to the whole list', () => {
    expect(BACKLOG_PAGE).toBe(50)
    expect(nextLimit(BACKLOG_PAGE, 130)).toBe(100)
    expect(nextLimit(100, 130)).toBe(130)
    expect(nextLimit(130, 130)).toBe(130)
  })
})
