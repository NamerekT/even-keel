import { describe, expect, it } from 'vitest'
import { DEFAULT_CLASSIFY, dbSettings, parseConfig } from './config.js'
import { DEFAULT_SIGN_RULES } from './signs.js'
import { DEFAULT_STEPS } from './step-runs.js'

const price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 }

describe('parseConfig', () => {
  it('reads prices per model prefix', () => {
    expect(parseConfig({ prices: { 'claude-opus-5-5': price } })).toEqual({
      evenKeelUrl: 'http://127.0.0.1:4747',
      prices: [{ model: 'claude-opus-5-5', ...price }],
      signs: DEFAULT_SIGN_RULES,
      classify: DEFAULT_CLASSIFY,
      ruleHistory: null,
      reportsSince: null,
      steps: DEFAULT_STEPS,
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

  it('takes the rule history path when given', () => {
    const prices = { 'claude-opus-5-5': price }
    expect(parseConfig({ prices }).ruleHistory).toBeNull()
    expect(parseConfig({ prices, ruleHistory: 'state/history.jsonl' }).ruleHistory).toBe('state/history.jsonl')
    expect(() => parseConfig({ prices, ruleHistory: 5 })).toThrow(/ruleHistory/)
  })

  it('takes the first day of Huly time reports as a date', () => {
    const prices = { 'claude-opus-5-5': price }
    expect(parseConfig({ prices, reportsSince: '2026-10-03' }).reportsSince).toBe('2026-10-03')
    expect(parseConfig({ prices, reportsSince: null }).reportsSince).toBeNull()
    expect(() => parseConfig({ prices, reportsSince: '3 Oct' })).toThrow(/reportsSince/)
  })

  it('lays step rules over the defaults and drops a rule set to null', () => {
    const prices = { 'claude-opus-5-5': price }
    const steps = parseConfig({
      prices,
      steps: {
        rules: { lint: '^npx\\s+eslint\\b', 'git-merge': null, 'unity-batch': null },
        projects: { Game: { bake: 'bake\\.ps1', stale: null } },
        slowSeconds: 120,
        growth: { ratio: 2 },
      },
    }).steps
    expect(Object.keys(steps.rules)).toEqual(['unity-check', 'vitest', 'dotnet-test', 'build', 'lint'])
    expect(steps.projects).toEqual({ Game: { bake: 'bake\\.ps1' } })
    expect([steps.slowSeconds, steps.growth]).toEqual([120, { ...DEFAULT_STEPS.growth, ratio: 2 }])
    expect(parseConfig({ prices }).steps).toEqual(DEFAULT_STEPS)
  })

  it('rejects a broken step rule or setting', () => {
    const prices = { 'claude-opus-5-5': price }
    expect(() => parseConfig({ prices, steps: { rules: { bad: '(' } } })).toThrow(/steps\.rules\.bad/)
    expect(() => parseConfig({ prices, steps: { projects: { Game: { bad: 5 } } } })).toThrow(/steps\.projects\.Game\.bad/)
    expect(() => parseConfig({ prices, steps: { slowSeconds: 0 } })).toThrow(/slowSeconds/)
    expect(() => parseConfig({ prices, steps: { growth: { ratio: 1 } } })).toThrow(/growth\.ratio/)
    expect(() => parseConfig({ prices, steps: { growth: { minRuns: 1.5 } } })).toThrow(/growth\.minRuns/)
    expect(() => parseConfig({ prices, steps: { speed: 1 } })).toThrow(/steps\.speed/)
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
