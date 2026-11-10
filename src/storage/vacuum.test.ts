import { expect, it } from 'vitest'
import { memoryDatabase } from './memory.js'
import { compactDatabase, vacuumDatabase } from './vacuum.js'

const sizeOf = async (db: Awaited<ReturnType<typeof memoryDatabase>>) =>
  Number((await db.query<{ bytes: string }>("select pg_total_relation_size('chain_lists') as bytes")).rows[0]!.bytes)

const churn = async (db: Awaited<ReturnType<typeof memoryDatabase>>, times: number) => {
  const value = 'x'.repeat(1000)
  for (let turn = 0; turn < times; turn++) {
    await db.exec('delete from chain_lists')
    await db.query("insert into chain_lists select 'P' || n, 'orders', $1 from generate_series(1, 40) n", [value])
  }
}

it('the vacuum lets a rewritten table reuse its dead rows', { timeout: 60_000 }, async () => {
  const db = await memoryDatabase()
  await churn(db, 20)
  await vacuumDatabase(db)
  const vacuumed = await sizeOf(db)
  await churn(db, 1)
  expect(await sizeOf(db)).toBe(vacuumed)
})

it('compacting gives the dead rows back and counts the live ones', { timeout: 60_000 }, async () => {
  const db = await memoryDatabase()
  await churn(db, 20)
  const bloated = await sizeOf(db)
  const lines: string[] = []
  await compactDatabase(db, (line) => lines.push(line))
  expect(lines).toEqual([expect.stringMatching(/^storage: the database was compacted in \d+ ms$/)])
  expect(await sizeOf(db)).toBeLessThan(bloated / 4)
  expect((await db.query<{ reltuples: number }>("select reltuples from pg_class where relname = 'chain_lists'")).rows[0]!.reltuples).toBe(40)
})

it('a vacuum that fails is logged, never thrown', { timeout: 60_000 }, async () => {
  const db = await memoryDatabase()
  await db.close()
  const lines: string[] = []
  await vacuumDatabase(db, (line) => lines.push(line))
  await compactDatabase(db, (line) => lines.push(line))
  expect(lines).toHaveLength(2)
  expect(lines[0]).toMatch(/^storage: the vacuum failed: /)
})
