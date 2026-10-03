import { describe, expect, it } from 'vitest'
import { dbSettings, parseConfig } from './config.js'

const price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 }

describe('parseConfig', () => {
  it('reads prices per model prefix', () => {
    expect(parseConfig({ prices: { 'claude-opus-5-5': price } })).toEqual({
      batonUrl: 'http://127.0.0.1:4747',
      prices: [{ model: 'claude-opus-5-5', ...price }],
    })
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
