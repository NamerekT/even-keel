import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it, vi } from 'vitest'
import type { TaskSource as LaunchHome } from '../../src/chain/launches.js'
import type { TimeTracker } from '../../src/stats/tally.js'
import type { TaskSource } from '../../src/tracker/source.js'
import type { BuiltinTask } from './builtin-tasks.js'
import { TallyDb } from './db.js'
import type { TimeReport } from './huly.js'
import { openLocalTally } from './local.js'
import { reportTaskTimes } from './steps.js'
import { taskHomes } from './task-homes.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const work = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'work', HULY_TOKEN: 'token-work' }
const huly = { projects: {}, fallback: work, elsewhere: ['ABC'], byId: { 'huly-work': work } }
const launched: LaunchHome[] = [{ task: 'ABC-1', profile: 'huly-work', url: 'https://huly.example.com/workbench/work/tracker/ABC-1', title: 'Parse the input' }]
const imported: BuiltinTask = {
  task: 'ABC-1', project: PROJECT, title: 'Parse the input', status: 'Done', labels: [], related: [], priority: 'high', estimateH: 20 / 60, component: 'Server',
  milestone: 'v0.3', done: true, createdAt: '2026-11-02T10:00:00.000Z',
}

it('gives a task launched from Huly and imported into the built-in tracker its estimate, component and card, and no Huly (BTN-1497)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-owned-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  const client = new pg.Client(local.settings)
  try {
    await db.migrate()
    // What the collector wrote before: the launch's profile and link, and no estimate from the built-in tracker.
    await db.syncTaskSources(launched)
    await db.writeTasks([], [{ ...imported, estimateH: null, component: null }])

    const homes = taskHomes(launched, [imported], [], huly)
    await db.syncTaskSources(homes.sources)
    await db.writeTasks([], [imported])
    await db.syncOwnedTasks(homes.owned)
    await client.connect()
    const { rows } = await client.query('select profile_id, url, estimate_h, component from tasks where task = $1', ['ABC-1'])
    expect(rows.map((row) => ({ ...row, estimate_h: Number(row.estimate_h) }))).toEqual([
      { profile_id: null, url: `/p/${PROJECT}?task=ABC-1`, estimate_h: expect.closeTo(1 / 3, 6), component: 'Server' },
    ])
    expect(homes.hulyOf('ABC-1')).toBeUndefined()

    const again = taskHomes(launched, [imported], [], huly)
    expect(await db.syncTaskSources(again.sources)).toBe(0)
    await db.writeTasks([], [imported])
    expect(await db.syncOwnedTasks(again.owned)).toBe(0)
  } finally {
    await client.end().catch(() => {})
    await db.close()
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)

it('reports no time of a built-in task to a tracker whose project has the same key, that project\'s own tasks still reported (BTN-1497)', async () => {
  const homes = taskHomes([], [imported], [], huly)
  const pending: TimeReport[] = [
    { task: 'ABC-1', hours: 0.5, date: '2026-11-20T10:00:00.000Z' },
    { task: 'ABC-50', hours: 1, date: '2026-11-20T11:00:00.000Z' },
  ]
  const db = { pendingReports: async () => pending, markReported: vi.fn(async () => {}) }
  const logTime = vi.fn(async () => true)
  const connect = vi.fn(async () => ({ logTime, close: async () => {} }) as unknown as TaskSource)
  const gitlab: TimeTracker = { kind: 'gitlab', values: {}, places: {}, prefixes: ['ABC'] }
  expect(await reportTaskTimes(db, '2026-11-01', homes.hulyOf, [gitlab], () => {}, homes.owned, connect)).toBe(1)
  expect(logTime.mock.calls.map(([task]) => task)).toEqual(['ABC-50'])
  expect(db.markReported).toHaveBeenCalledWith(new Map([['ABC-50', 1]]))
})
