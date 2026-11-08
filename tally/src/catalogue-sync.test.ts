import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it } from 'vitest'
import type { Price } from './config.js'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'
import { emptyBatch, type MessageRow } from './parse.js'

const price = (model: string, input: number): Price => ({ model, input, output: input, cacheRead: input, cacheWrite5m: input, cacheWrite1h: 0, longPrompt: null })

function message(id: string, model: string, provider: string | null): MessageRow {
  return {
    messageId: id, sessionId: 's', agentId: null, account: 'a', project: null, projectDir: null, task: null, branch: null,
    entrypoint: null, model, speed: null, effort: null, at: '2026-11-01T10:00:00Z',
    input: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, provider,
  }
}

it('asks the catalogue only for models no config price covers, and keeps each source to its own sync', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-catalogue-sync-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  try {
    await db.migrate()
    const batch = emptyBatch()
    for (const row of [
      message('m1', 'claude-opus-9-20261101', 'anthropic'),
      message('m2', 'qwen-9', 'openrouter'),
      message('m3', 'qwen-9', 'chutes'),
      message('m4', 'gpt-reserve', 'openai'),
      message('m5', 'copilot-9', null),
    ]) batch.messages.set(row.messageId, row)
    await db.write(batch, { path: join(dir, 'f.jsonl'), account: 'a', offset: 0, size: 0, mtime: new Date(0).toISOString(), ino: '1', head: '', headLen: 0 })

    await db.syncPrices([price('claude-opus-9', 1)])
    expect(await db.catalogueWanted(['gpt-reserve'])).toEqual([
      { provider: 'chutes', model: 'qwen-9' },
      { provider: 'openrouter', model: 'qwen-9' },
    ])

    await db.syncCataloguePrices([price('openrouter/qwen-9', 2), price('claude-opus-9', 50)])
    await db.syncPrices([price('claude-opus-9', 3)])
    await db.syncCataloguePrices([price('openrouter/qwen-9', 4)])
    const rows = await db.unpricedModels()
    expect(rows).toEqual(['copilot-9', 'gpt-reserve', 'qwen-9'])
    const client = new pg.Client(local.settings)
    await client.connect()
    const costs = await client.query<{ message_id: string; cost: string | null; price_source: string | null }>(
      'select message_id, cost, price_source from message_costs order by message_id',
    )
    await client.end()
    expect(costs.rows.map((row) => [row.message_id, row.cost === null ? null : Number(row.cost), row.price_source])).toEqual([
      ['m1', 0.000003, 'config'],
      ['m2', 0.000004, 'catalogue'],
      ['m3', null, null],
      ['m4', null, null],
      ['m5', null, null],
    ])
  } finally {
    await db.close()
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 120_000)
