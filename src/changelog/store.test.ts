import type { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChangelogSpend, ChangelogVersion } from '../state.js'
import { openDatabase } from '../storage/database.js'
import { addVersion, latestVersion, markWritten, spentOn, writtenTasks } from './store.js'

const IDS = { ABC: '11111111-1111-4111-8111-111111111111' }

const version = (fields: Partial<ChangelogVersion> = {}): Omit<ChangelogVersion, 'number' | 'written'> => ({
  project: 'ABC',
  milestone: 'v0.1',
  kind: 'draft',
  text: '## [Unreleased]\n\n- A',
  base: null,
  instruction: null,
  tasks: ['ABC-1'],
  open: 0,
  at: '2026-10-18T11:00:00.000Z',
  spend: null,
  ...fields,
})

const spend = (cost: number | null, input: number): ChangelogSpend => ({
  account: 'work',
  model: 'claude-sonnet-5-5',
  tokens: { input, output: 10, cacheRead: 100, cacheWrite: 0 },
  cost,
  durationMs: 1_000,
})

describe('changelog versions', { timeout: 60_000 }, () => {
  let db: PGlite
  beforeEach(async () => {
    db = await openDatabase(undefined)
  })
  afterEach(() => db.close())

  it('numbers the versions per milestone and gives the latest', async () => {
    expect(await latestVersion(db, 'ABC', 'v0.1', IDS)).toBeNull()
    expect(await addVersion(db, version(), IDS)).toBe(1)
    expect(await addVersion(db, version({ milestone: 'v0.2' }), IDS)).toBe(1)
    expect(await addVersion(db, version({ kind: 'edit', text: 'B', base: 'A', instruction: 'Shorter' }), IDS)).toBe(2)
    expect(await latestVersion(db, 'ABC', 'v0.1', IDS)).toEqual({ ...version({ kind: 'edit', text: 'B', base: 'A', instruction: 'Shorter' }), number: 2, written: null })
    const { rows } = await db.query<{ project_id: string }>('select distinct project_id from changelog_versions')
    expect(rows).toEqual([{ project_id: IDS.ABC }])
  })

  it("keeps each version's spend and sums the milestone's, the turns without a cost apart", async () => {
    expect(await spentOn(db, 'ABC', 'v0.1', IDS)).toEqual({ turns: 0, cost: 0, unpriced: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
    await addVersion(db, version({ spend: spend(0.25, 1_000) }), IDS)
    await addVersion(db, version(), IDS)
    await addVersion(db, version({ spend: spend(null, 500) }), IDS)
    await addVersion(db, version({ milestone: 'v0.2', spend: spend(9, 9) }), IDS)
    await addVersion(db, version({ spend: spend(0.5, 2_000) }), IDS)
    expect((await latestVersion(db, 'ABC', 'v0.1', IDS))?.spend).toEqual(spend(0.5, 2_000))
    expect(await spentOn(db, 'ABC', 'v0.1', IDS)).toEqual({ turns: 3, cost: 0.75, unpriced: 1, tokens: { input: 3_500, output: 30, cacheRead: 300, cacheWrite: 0 } })
  })

  it('gives the tasks of the last written version of each milestone', async () => {
    await addVersion(db, version({ tasks: ['ABC-1'] }), IDS)
    await addVersion(db, version({ tasks: ['ABC-1', 'ABC-2'] }), IDS)
    await addVersion(db, version({ tasks: ['ABC-1', 'ABC-2', 'ABC-3'] }), IDS)
    expect(await writtenTasks(db, IDS)).toEqual({})
    await markWritten(db, 'ABC', 'v0.1', 1, { at: '2026-10-18T11:05:00.000Z', commit: 'abc' }, IDS)
    await markWritten(db, 'ABC', 'v0.1', 2, { at: '2026-10-18T11:06:00.000Z', commit: 'def' }, IDS)
    expect(await writtenTasks(db, IDS)).toEqual({ ABC: { 'v0.1': ['ABC-1', 'ABC-2'] } })
    expect((await latestVersion(db, 'ABC', 'v0.1', IDS))?.written).toBeNull()
  })
})
