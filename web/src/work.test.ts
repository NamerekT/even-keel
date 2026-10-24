import { describe, expect, it } from 'vitest'
import { notice } from '../../src/notice/notice.js'
import { shownWork, type WorkInput } from './work.js'

const work = { path: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', files: 2, ahead: 0 }
const order = { order: ['ABC-2'], waiting: ['ABC-3'], backlog: ['ABC-1'], error: null }
const input = (fields: { works?: object; extra?: object; skipped?: string[]; leftovers?: object; sessions?: object[]; tasks?: object[] } = {}) =>
  ({
    chain: { projects: { p1: { ...order, ...fields.extra } }, skipped: { p1: fields.skipped ?? [] }, leftovers: fields.leftovers ?? {} },
    works: { p1: fields.works ?? {} },
    sessions: fields.sessions ?? [],
    tasks: fields.tasks ?? [],
  }) as unknown as WorkInput
const working = (task: string) => ({ task, sessionId: 's1', lamp: 'working' })

describe('shownWork', () => {
  it('shows the work of a backlog task or one out of the chain', () => {
    expect(shownWork(input({ works: { 'ABC-1': work } }), 'p1', 'ABC-1')).toEqual(work)
    expect(shownWork(input({ works: { 'ABC-9': work } }), 'p1', 'ABC-9')).toEqual(work)
    expect(shownWork(input(), 'p1', 'ABC-1')).toBeNull()
  })

  it('hides the work of a task the chain leads or one a session works on, as its session is still changing it', () => {
    expect(shownWork(input({ works: { 'ABC-2': work } }), 'p1', 'ABC-2')).toBeNull()
    expect(shownWork(input({ works: { 'ABC-3': work } }), 'p1', 'ABC-3')).toBeNull()
    expect(shownWork(input({ works: { 'ABC-1': work }, sessions: [working('ABC-1')] }), 'p1', 'ABC-1')).toBeNull()
  })

  it('shows the work of a skipped task, though it is still in the chain', () => {
    expect(shownWork(input({ works: { 'ABC-2': work }, skipped: ['ABC-2'] }), 'p1', 'ABC-2')).toEqual(work)
  })

  it('shows the work of a task with a pull request only for files left out of a commit', () => {
    const reviews = [{ task: 'ABC-9', number: 7, url: 'https://example.com/pull/7', feedback: false }]
    expect(shownWork(input({ works: { 'ABC-9': { ...work, files: 0, ahead: 2 } }, extra: { reviews } }), 'p1', 'ABC-9')).toBeNull()
    expect(shownWork(input({ works: { 'ABC-9': work }, extra: { reviews } }), 'p1', 'ABC-9')).toEqual(work)
  })

  it('shows the work of a closed task only once its cleanup said what it left', () => {
    const done = { id: 'ABC-9', project: 'p1', title: 'Done', status: { name: 'Done', category: 'Won' } }
    const leftover = { task: 'ABC-9', at: '2026-10-23T18:00:00Z', notice: notice('cleanup.worktreeKept', { path: work.path }) }
    expect(shownWork(input({ works: { 'ABC-9': work }, tasks: [done] }), 'p1', 'ABC-9')).toBeNull()
    expect(shownWork(input({ works: { 'ABC-9': work }, tasks: [done], leftovers: { p1: [leftover] } }), 'p1', 'ABC-9')).toEqual(work)
  })

  it('shows no work of an open task the chain cannot order, as it does not know which it leads', () => {
    const error = notice('chain.unknownProject', { project: 'p1' })
    expect(shownWork(input({ works: { 'ABC-1': work }, extra: { error } }), 'p1', 'ABC-1')).toBeNull()
    expect(shownWork(input({ works: { 'ABC-2': work }, extra: { error }, skipped: ['ABC-2'] }), 'p1', 'ABC-2')).toEqual(work)
  })
})
