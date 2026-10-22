import { describe, expect, it } from 'vitest'
import { fakeTask } from '../tracker/fixture.js'
import { archivedShown } from './archive.js'
import type { ClosedTask } from './store.js'

const closed = (task: string, closedAt: string, fields: Partial<ClosedTask> = {}): ClosedTask => ({
  project: 'abc',
  task,
  tracker: 'github',
  title: `Title of ${task}`,
  url: null,
  closedAt,
  profile: null,
  status: 'closed',
  ...fields,
})

describe('archivedShown', () => {
  const since = new Date('2026-10-15T00:00:00.000Z')

  it("gives the project's archived tasks closed since then that its trackers no longer list, as closed", () => {
    const archive = [
      closed('ABCGH-1', '2026-10-20T00:00:00.000Z'),
      closed('ABC-2', '2026-10-20T00:00:00.000Z'),
      closed('ABCGH-3', '2026-10-01T00:00:00.000Z'),
      closed('XYZ-4', '2026-10-20T00:00:00.000Z', { project: 'xyz' }),
      closed('ABCGH-5', '2026-10-21T00:00:00.000Z', { status: null }),
    ]
    const shown = archivedShown(archive, 'abc', [fakeTask('ABC-2')], since)
    expect(shown.map((task) => [task.id, task.title, task.status])).toEqual([
      ['ABCGH-1', 'Title of ABCGH-1', { name: 'closed', category: 'Won' }],
      ['ABCGH-5', 'Title of ABCGH-5', { name: 'Done', category: 'Won' }],
    ])
  })
})
