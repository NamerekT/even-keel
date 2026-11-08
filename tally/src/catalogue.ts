import { readFileSync, statSync } from 'node:fs'
import type { AccountHome } from '../../src/account/homes.js'
import { OPENCODE } from '../../src/opencode/name.js'
import { catalogueFile } from '../../src/opencode/window.js'
import type { Price, Rates } from './config.js'

/**
 * Prices of models the config does not price, from OpenCode's copy of the models.dev catalogue (BTN-859):
 * `{ <provider>: { models: { <model>: { cost } } } }`, USD per million tokens as in the config. Tally never fetches it
 * itself; with no OpenCode account folder holding a copy there are no catalogue prices.
 */
export type Catalogue = Record<string, unknown>

/** A response's model with the provider that served it: its catalogue key is `<provider>/<model>`. */
export interface CatalogueModel {
  provider: string
  model: string
}

// models.dev names the long prompt price `context_over_200k`; its `tiers` give the actual threshold.
const OVER_200K = 200_000

/** The most recently written copy among the OpenCode accounts' folders; a copy that does not parse is skipped. */
export function newestCatalogue(homes: AccountHome[]): Catalogue | undefined {
  const files = homes
    .filter((home) => home.agent === OPENCODE)
    .flatMap((home) => {
      const file = catalogueFile(home.dir)
      try {
        return [{ file, mtime: statSync(file).mtimeMs }]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
  for (const { file } of files) {
    try {
      const parsed = record(JSON.parse(readFileSync(file, 'utf8')))
      if (parsed !== undefined) return parsed
    } catch {
      // the next copy
    }
  }
  return undefined
}

/**
 * The price of each model the catalogue has with input and output rates, keyed `<provider>/<model>`. A cache write is
 * the 5-minute rate, none at 1 hour; a missing cache read or write costs as input. The first context tier, else
 * `context_over_200k`, is the long prompt price.
 */
export function cataloguePrices(catalogue: Catalogue, models: CatalogueModel[]): Price[] {
  return models.flatMap(({ provider, model }) => {
    const cost = record(record(record(record(catalogue[provider])?.models)?.[model])?.cost)
    const base = cost === undefined ? undefined : ratesOf(cost)
    if (cost === undefined || base === undefined) return []
    return [{ model: `${provider}/${model}`, ...base, longPrompt: longPromptOf(cost) }]
  })
}

function longPromptOf(cost: Record<string, unknown>): Price['longPrompt'] {
  const tier = (Array.isArray(cost.tiers) ? cost.tiers : []).map(record).find((each) => record(each?.tier)?.type === 'context')
  const size = record(tier?.tier)?.size
  if (tier !== undefined && typeof size === 'number' && size > 0) {
    const rates = ratesOf(tier)
    if (rates !== undefined) return { over: size, ...rates }
  }
  const over = record(cost.context_over_200k)
  const rates = over === undefined ? undefined : ratesOf(over)
  return rates === undefined ? null : { over: OVER_200K, ...rates }
}

function ratesOf(cost: Record<string, unknown>): Rates | undefined {
  const input = rate(cost.input)
  const output = rate(cost.output)
  if (input === undefined || output === undefined) return undefined
  return { input, output, cacheRead: rate(cost.cache_read) ?? input, cacheWrite5m: rate(cost.cache_write) ?? input, cacheWrite1h: 0 }
}

function rate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
