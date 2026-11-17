import { expect, it } from 'vitest'
import { openMachineDatabase } from '../link/machine-store.js'
import { machineMarks, shipLine } from './tally.js'

const file = (path: string, offset: number) => ({
  path, account: 'global', offset, size: offset, mtime: '2026-11-17T10:00:00.000Z', ino: '42', head: 'fake-head', headLen: offset,
})

it("keeps the machine's read marks in its database and forgets those of gone files", { timeout: 60_000 }, async () => {
  const db = await openMachineDatabase(undefined)
  try {
    const marks = machineMarks(db)
    await marks.mark(file('/work/a.jsonl', 10))
    await marks.mark(file('/work/a.jsonl', 20))
    await marks.mark(file('/work/b.jsonl', 5))
    expect([...(await marks.marks()).values()]).toEqual(expect.arrayContaining([file('/work/a.jsonl', 20), file('/work/b.jsonl', 5)]))
    expect(await marks.forgetExcept(['/work/a.jsonl'])).toBe(1)
    expect([...(await marks.marks()).keys()]).toEqual(['/work/a.jsonl'])
  } finally {
    await db.close()
  }
})

it('logs a pass only when it sent something or failed', () => {
  expect(shipLine({ state: 'done', files: 0, lines: 0, failed: 0, forgotten: 0 })).toBeUndefined()
  expect(shipLine({ state: 'done', files: 2, lines: 30, failed: 1, forgotten: 0 })).toBe('tally: 30 lines of 2 files sent to the hub, 1 failed')
  expect(shipLine({ state: 'away', files: 0, lines: 0 })).toBeUndefined()
})
