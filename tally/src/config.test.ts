import { describe, expect, it } from 'vitest'
import { DEFAULT_CLASSIFY, dbSettings, parseConfig } from './config.js'
import { DEFAULT_SIGN_RULES } from './signs.js'

const price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 }

describe('parseConfig', () => {
  it('reads prices per model prefix', () => {
    expect(parseConfig({ prices: { 'claude-opus-5-5': price } })).toEqual({
      batonUrl: 'http://127.0.0.1:4747',
      prices: [{ model: 'claude-opus-5-5', ...price }],
      signs: DEFAULT_SIGN_RULES,
      classify: DEFAULT_CLASSIFY,
    })
  })

  it('lays sign rules and classifier settings over the defaults', () => {
    const config = parseConfig({ prices: { 'claude-opus-5-5': price }, signs: { repeatRun: 4 }, classify: { perRun: 0 } })
    expect(config.signs).toEqual({ ...DEFAULT_SIGN_RULES, repeatRun: 4 })
    expect(config.classify).toEqual({ ...DEFAULT_CLASSIFY, perRun: 0 })
  })

  it('rejects unknown or non-integer sign and classifier settings', () => {
    const prices = { 'claude-opus-5-5': price }
    expect(() => parseConfig({ prices, signs: { repeatRun: 0 } })).toThrow(/signs.repeatRun/)
    expect(() => parseConfig({ prices, signs: { repeats: 2 } })).toThrow(/signs.repeats/)
    expect(() => parseConfig({ prices, classify: { idleMinutes: 1.5 } })).toThrow(/classify.idleMinutes/)
    expect(() => parseConfig({ prices, classify: { perRun: -1 } })).toThrow(/classify.perRun/)
  })

  it('rejects a price with a missing or negative number', () => {
    expect(() => parseConfig({ prices: { 'claude-opus-5-5': { ...price, cacheWrite1h: undefined } } })).toThrow(/cacheWrite1h/)
    expect(() => parseConfig({ prices: { 'claude-opus-5-5': { ...price, output: -1 } } })).toThrow(/output/)
  })

  it('needs at least one price', () => {
    expect(() => parseConfig({})).toThrow(/prices/)
  })
})

describe('dbSettings', () => {
  it('connects as the writer from the environment', () => {
    expect(dbSettings({ TALLY_DB_HOST: '100.64.0.1', TALLY_DB_NAME: 'tally', TALLY_WRITER_PASSWORD: 'secret' })).toEqual({
      host: '100.64.0.1',
      port: 5432,
      database: 'tally',
      user: 'tally_writer',
      password: 'secret',
    })
  })

  it('names the missing variables', () => {
    expect(() => dbSettings({ TALLY_DB_HOST: 'h' })).toThrow(/TALLY_WRITER_PASSWORD/)
  })
})
