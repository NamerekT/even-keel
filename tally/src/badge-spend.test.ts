import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { BadgeTranslations, readTranslationSpend } from '../../src/badge/translate.js'
import { memoryDatabase } from '../../src/storage/memory.js'
import { root } from '../../src/locations.js'
import { parseConfig } from './config.js'
import { writeLlmCosts } from './db-classify.js'
import { migrate, pgliteDb } from './migrations.js'

it('retains translation usage for Tally and replays it without duplication, including an empty answer', async () => {
  const state = await memoryDatabase()
  const translations = new BadgeTranslations(state, {
    env: () => ({ TALLY_LLM_URL: 'https://llm.example.com', TALLY_LLM_KEY: 'fake-key' }),
    request: async () => new Response(JSON.stringify({ id: 'reply-1', model: 'gemini/google-gemini-test',
      choices: [{ message: { content: '' } }], usage: { prompt_tokens: 100, completion_tokens: 12 } })),
    log: () => {},
  })
  translations.title({ tracker: 'example', id: 'ABC-1', title: 'Заголовок' }, true)
  await translations.settle()
  const costs = await readTranslationSpend(state)
  expect(costs).toHaveLength(1)
  expect(costs[0]).toMatchObject({ account: 'litellm', entrypoint: 'badge-translate', model: 'google-gemini-test', input: 100, output: 12, task: null })
  const tally = await PGlite.create()
  try {
    await migrate(pgliteDb(tally))
    const price = parseConfig(JSON.parse(readFileSync(join(root, 'tally/tally.config.json'), 'utf8'))).prices.find((each) => each.model === 'google-gemini')!
    await tally.query('insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ($1, $2, $3, $4, $5, $6)',
      [price.model, price.input, price.output, price.cacheRead, price.cacheWrite5m, price.cacheWrite1h])
    await writeLlmCosts(tally, costs)
    await writeLlmCosts(tally, await readTranslationSpend(state))
    expect((await tally.query('select entrypoint, input, output from messages')).rows).toEqual([
      { entrypoint: 'badge-translate', input: 100, output: 12 },
    ])
    const priced = await tally.query<{ cost: string; price_model: string }>('select cost, price_model from message_costs')
    expect(priced.rows[0]?.price_model).toBe('google-gemini')
    expect(Number(priced.rows[0]?.cost)).toBe(0)
  } finally {
    await tally.close()
  }
}, 60_000)
