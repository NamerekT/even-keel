import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LaunchEntry } from '../../src/chain/model.js'
import type { ClosedTask } from '../../src/chain/store.js'
import { closedStates, type ClosedState } from './closed-tasks.js'
import { CLOSED_TASK_STATES } from './db.js'
import { migrate, pgliteDb } from './migrations.js'

function closed(task: string, tracker: string, closedAt: string, status: string | null = 'Closed', project = 'p1'): ClosedTask {
  return { project, task, tracker, title: task, url: null, closedAt, profile: null, status }
}

function launch(task: string, at: string, reason?: LaunchEntry['reason']): LaunchEntry {
  return { at, project: 'p1', task, sessionId: `s-${task}-${at}`, ...(reason === undefined ? {} : { reason }) }
}

describe('closedStates', () => {
  it('gives a GitHub or Linear task the chain saw closed its last status and marks it done', () => {
    const states = closedStates(
      [closed('ABCGH-1', 'github', '2026-10-20T10:00:00Z'), closed('WEB-2', 'linear', '2026-10-21T10:00:00Z', 'Done')],
      [launch('ABCGH-1', '2026-10-20T09:00:00Z'), launch('WEB-2', '2026-10-21T09:00:00Z')],
    )
    expect(states).toEqual([
      { task: 'ABCGH-1', status: 'Closed', done: true },
      { task: 'WEB-2', status: 'Done', done: true },
    ])
  })

  it('leaves Huly tasks to Huly', () => {
    expect(closedStates([closed('ABC-1', 'huly', '2026-10-20T10:00:00Z')], [])).toEqual([])
  })

  it('marks done a task archived before statuses were kept, without a status', () => {
    expect(closedStates([closed('ABCGH-3', 'github', '2026-10-20T10:00:00Z', null)], [])).toEqual([{ task: 'ABCGH-3', status: null, done: true }])
  })

  it('takes a task the chain launched again after it closed as open, without a status', () => {
    const states = closedStates([closed('ABCGH-4', 'github', '2026-10-20T10:00:00Z')], [launch('ABCGH-4', '2026-10-22T08:00:00Z')])
    expect(states).toEqual([{ task: 'ABCGH-4', status: null, done: false }])
  })

  it('does not take a release of the task after it closed for a new launch', () => {
    const states = closedStates([closed('ABCGH-5', 'github', '2026-10-20T10:00:00Z')], [launch('ABCGH-5', '2026-10-22T08:00:00Z', 'skip')])
    expect(states).toEqual([{ task: 'ABCGH-5', status: 'Closed', done: true }])
  })

  it('takes the latest close of a task id archived in two projects', () => {
    const states = closedStates(
      [closed('ABCGH-6', 'github', '2026-10-22T10:00:00Z', 'Closed', 'p2'), closed('ABCGH-6', 'github', '2026-10-20T10:00:00Z', 'Won', 'p1')],
      [launch('ABCGH-6', '2026-10-21T08:00:00Z')],
    )
    expect(states).toEqual([{ task: 'ABCGH-6', status: 'Closed', done: true }])
  })
})

describe('CLOSED_TASK_STATES', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await migrate(pgliteDb(db))
    await db.exec(`insert into tasks (task, title, status, done, fetched_at) values
      ('ABCGH-1', 'Fix the page', null, null, 'epoch'), ('ABCGH-2', 'Old one', 'Closed', true, 'epoch'), ('ABCGH-3', 'Reopened', 'Closed', true, 'epoch')`)
    const states: ClosedState[] = [
      { task: 'ABCGH-1', status: 'Closed', done: true },
      { task: 'ABCGH-2', status: null, done: true },
      { task: 'ABCGH-3', status: null, done: false },
      { task: 'ABCGH-4', status: 'Done', done: true },
    ]
    await db.query(CLOSED_TASK_STATES, [JSON.stringify(states)])
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  it('writes the status and the done mark, keeping a status the archive lacks and dropping that of a reopened task', async () => {
    const { rows } = await db.query<{ task: string; title: string | null; status: string | null; done: boolean | null }>(
      'select task, title, status, done from tasks order by task',
    )
    expect(rows).toEqual([
      { task: 'ABCGH-1', title: 'Fix the page', status: 'Closed', done: true },
      { task: 'ABCGH-2', title: 'Old one', status: 'Closed', done: true },
      { task: 'ABCGH-3', title: 'Reopened', status: null, done: false },
      { task: 'ABCGH-4', title: null, status: 'Done', done: true },
    ])
  })
})
