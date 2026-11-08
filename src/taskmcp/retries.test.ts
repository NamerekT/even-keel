import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { root } from '../locations.js'
import { openDatabase } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { TaskRetries } from './retries.js'

it('keeps the newest 200 first-used keys across instances, including partial batches', { timeout: 60_000 }, async () => {
  const db = await memoryDatabase()
  const journal = new TaskRetries(db)
  const save = (key: string) => journal.run('project', key, async ({ ids, save }) => {
    ids.push('ABC-1')
    await save()
  })
  await save('oldest')
  await save('partial')
  for (let i = 0; i < 198; i++) await save(`key-${i}`)
  await journal.run('project', 'oldest', async ({ ids }) => expect(ids).toEqual(['ABC-1']))
  await save('newest')
  const restarted = new TaskRetries(db)
  await restarted.run('project', 'partial', async ({ ids }) => expect(ids).toEqual(['ABC-1']))
  expect((await db.query('select * from task_retries')).rows).toHaveLength(200)
  await restarted.run('project', 'oldest', async ({ ids }) => expect(ids).toEqual([]))
})

it('a saved ID survives closing and reopening the database folder', { timeout: 120_000 }, async () => {
  await mkdir(join(root, '.temp'), { recursive: true })
  const dir = await mkdtemp(join(root, '.temp', 'task-retries-'))
  let db = await openDatabase(dir)
  try {
    await new TaskRetries(db).run('project', 'batch', async ({ ids, save }) => {
      ids.push('ABC-1', 'ABC-2')
      await save()
    })
    await db.close()
    db = await openDatabase(dir)
    await new TaskRetries(db).run('project', 'batch', async ({ ids }) => expect(ids).toEqual(['ABC-1', 'ABC-2']))
  } finally {
    if (!db.closed) await db.close()
    await rm(dir, { recursive: true, force: true })
  }
})
