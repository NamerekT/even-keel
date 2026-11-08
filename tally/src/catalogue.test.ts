import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountHome } from '../../src/account/homes.js'
import { catalogueFile } from '../../src/opencode/window.js'
import { cataloguePrices, newestCatalogue } from './catalogue.js'

const CATALOGUE = {
  anthropic: { models: { 'claude-opus-9': { cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } } } },
  openai: {
    models: {
      'gpt-9-sol': {
        cost: {
          input: 2, output: 10, cache_read: 0.2,
          tiers: [{ input: 4, output: 15, cache_read: 0.4, tier: { type: 'context', size: 272000 } }],
          context_over_200k: { input: 4, output: 15, cache_read: 0.4 },
        },
      },
    },
  },
  google: { models: { 'gemini-9': { cost: { input: 1, output: 4, context_over_200k: { input: 2, output: 8 } } }, 'free-9': {} } },
}

describe('prices from the models.dev catalogue', () => {
  it('prices an exact provider and model, the cache write at the 5m rate and none at 1h', () => {
    expect(cataloguePrices(CATALOGUE, [{ provider: 'anthropic', model: 'claude-opus-9' }])).toEqual([
      { model: 'anthropic/claude-opus-9', input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 0, longPrompt: null },
    ])
  })

  it('prices a missing cache write or read as input, and takes a context tier as the long prompt price', () => {
    expect(cataloguePrices(CATALOGUE, [{ provider: 'openai', model: 'gpt-9-sol' }, { provider: 'google', model: 'gemini-9' }])).toEqual([
      {
        model: 'openai/gpt-9-sol', input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2, cacheWrite1h: 0,
        longPrompt: { over: 272000, input: 4, output: 15, cacheRead: 0.4, cacheWrite5m: 4, cacheWrite1h: 0 },
      },
      {
        model: 'google/gemini-9', input: 1, output: 4, cacheRead: 1, cacheWrite5m: 1, cacheWrite1h: 0,
        longPrompt: { over: 200000, input: 2, output: 8, cacheRead: 2, cacheWrite5m: 2, cacheWrite1h: 0 },
      },
    ])
  })

  it('gives no price for a model it lacks, one without a cost, or another provider of the same name', () => {
    expect(
      cataloguePrices(CATALOGUE, [
        { provider: 'google', model: 'free-9' },
        { provider: 'openrouter', model: 'claude-opus-9' },
        { provider: 'anthropic', model: 'claude-opus' },
      ]),
    ).toEqual([])
  })
})

describe('the newest catalogue of the OpenCode accounts', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function home(agent: string, catalogue?: unknown, mtime?: Date): AccountHome {
    const dir = mkdtempSync(join(tmpdir(), 'tally-catalogue-'))
    dirs.push(dir)
    if (catalogue !== undefined) {
      const file = catalogueFile(dir)
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, typeof catalogue === 'string' ? catalogue : JSON.stringify(catalogue))
      if (mtime !== undefined) utimesSync(file, mtime, mtime)
    }
    return { key: dir, dir, global: false, agent }
  }

  it('reads the most recently written copy among OpenCode folders only', () => {
    const old = home('opencode', { old: {} }, new Date('2026-10-01'))
    const fresh = home('opencode', { fresh: {} }, new Date('2026-11-01'))
    const claude = home('claude', { claude: {} }, new Date('2026-11-05'))
    expect(newestCatalogue([old, claude, fresh])).toEqual({ fresh: {} })
  })

  it('skips a broken copy and reads none without OpenCode folders', () => {
    const broken = home('opencode', '{', new Date('2026-11-01'))
    const good = home('opencode', { good: {} }, new Date('2026-10-01'))
    expect(newestCatalogue([broken, good])).toEqual({ good: {} })
    expect(newestCatalogue([home('opencode'), home('claude', { claude: {} })])).toBeUndefined()
  })
})
