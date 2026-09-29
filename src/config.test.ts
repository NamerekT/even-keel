import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from './chain/rules.js'
import { liveConfig, parseConfig, restartChanges } from './config.js'

describe('parseConfig', () => {
  it('fills defaults when only projects are given', () => {
    const config = parseConfig({ projects: { ABC: 'C:\\repos\\abc' } })
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 4747,
      projects: { ABC: 'C:\\repos\\abc' },
      rules: { ABC: DEFAULT_RULES },
      context: { window: 600_000, warn: 50, danger: 80 },
      modelPrompts: {},
    })
  })

  it('keeps model prompts keyed by model alias', () => {
    const config = parseConfig({ projects: {}, modelPrompts: { sonnet: 'You are Sonnet.' } })
    expect(config.modelPrompts).toEqual({ sonnet: 'You are Sonnet.' })
  })

  it('rejects a model prompt under an unknown alias or with an empty text', () => {
    expect(() => parseConfig({ projects: {}, modelPrompts: { gpt: 'x' } })).toThrow(/gpt/)
    expect(() => parseConfig({ projects: {}, modelPrompts: { sonnet: ' ' } })).toThrow(/sonnet/)
    expect(() => parseConfig({ projects: {}, modelPrompts: 'x' })).toThrow(/modelPrompts/)
  })

  it('keeps explicit host and port', () => {
    const config = parseConfig({ host: '127.0.0.1', port: 5000, projects: {} })
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(5000)
  })

  it('rejects a port outside the TCP range', () => {
    expect(() => parseConfig({ port: 70000, projects: {} })).toThrow(/port/)
  })

  it('rejects a project key that is not a Huly identifier', () => {
    expect(() => parseConfig({ projects: { 'bad key': 'C:\\x' } })).toThrow(/bad key/)
  })

  it('rejects an empty repository path', () => {
    expect(() => parseConfig({ projects: { ABC: '' } })).toThrow(/ABC/)
  })

  it('rejects a missing projects map', () => {
    expect(() => parseConfig({})).toThrow(/projects/)
  })
  it('keeps an explicit context scale', () => {
    const config = parseConfig({ projects: {}, context: { window: 200_000, warn: 60, danger: 85 } })
    expect(config.context).toEqual({ window: 200_000, warn: 60, danger: 85 })
  })

  it('fills the missing parts of a context scale', () => {
    expect(parseConfig({ projects: {}, context: { window: 1_000_000 } }).context).toEqual({
      window: 1_000_000,
      warn: 50,
      danger: 80,
    })
  })

  it('rejects a context window that is not a positive integer', () => {
    expect(() => parseConfig({ projects: {}, context: { window: 0 } })).toThrow(/context.window/)
    expect(() => parseConfig({ projects: {}, context: { window: 1.5 } })).toThrow(/context.window/)
  })

  it('rejects context thresholds outside 0..100 or out of order', () => {
    expect(() => parseConfig({ projects: {}, context: { warn: 0 } })).toThrow(/context/)
    expect(() => parseConfig({ projects: {}, context: { danger: 120 } })).toThrow(/context/)
    expect(() => parseConfig({ projects: {}, context: { warn: 80, danger: 80 } })).toThrow(/context/)
  })

  it('rejects a context scale that is not an object', () => {
    expect(() => parseConfig({ projects: {}, context: 600_000 })).toThrow(/context/)
  })
})

describe('chain rules in the config', () => {
  it('give every project the default rules when none are set', () => {
    expect(parseConfig({ projects: { ABC: 'C:\\abc' } }).rules).toEqual({ ABC: DEFAULT_RULES })
  })

  it('take a project as an object with its repository and rules over the shared ones', () => {
    const config = parseConfig({
      chain: { active: ['Todo', 'In Progress'], requiredLabels: ['Auto'] },
      projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', chain: { requiredLabels: [], terminal: ['Done'] } } },
    })
    expect(config.projects).toEqual({ ABC: 'C:\\abc', XYZ: 'C:\\xyz' })
    expect(config.rules.ABC).toEqual({ ...DEFAULT_RULES, active: ['Todo', 'In Progress'], requiredLabels: ['Auto'] })
    expect(config.rules.XYZ).toEqual({ ...DEFAULT_RULES, active: ['Todo', 'In Progress'], terminal: ['Done'], requiredLabels: [] })
  })

  it('trim the names it keeps', () => {
    expect(parseConfig({ chain: { excludedLabels: [' Manual '] }, projects: { ABC: 'C:\\abc' } }).rules.ABC?.excludedLabels).toEqual(['Manual'])
  })

  it('reject a project object without a repository', () => {
    expect(() => parseConfig({ projects: { ABC: { chain: {} } } })).toThrow(/ABC/)
  })

  it('reject a rule that is not a list of names', () => {
    expect(() => parseConfig({ chain: { active: 'Todo' }, projects: {} })).toThrow(/chain.active/)
    expect(() => parseConfig({ chain: { requiredLabels: ['Auto', ' '] }, projects: {} })).toThrow(/chain.requiredLabels/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', chain: { terminal: [1] } } } })).toThrow(/ABC.chain.terminal/)
    expect(() => parseConfig({ chain: { activeStates: [] }, projects: {} })).toThrow(/activeStates/)
    expect(() => parseConfig({ chain: [], projects: {} })).toThrow(/chain/)
  })

  it('reject a status that is both active and terminal', () => {
    expect(() =>
      parseConfig({ chain: { active: ['Todo', 'In Review'] }, projects: { ABC: { repo: 'C:\\abc', chain: { terminal: [' in review '] } } } }),
    ).toThrow(/ABC.*in review/i)
  })

  it('reject a label that is both required and excluded', () => {
    expect(() => parseConfig({ chain: { requiredLabels: ['Вручную'] }, projects: { ABC: 'C:\\abc' } })).toThrow(/ABC.*Вручную/)
  })
})

describe('reloading the config', () => {
  const base = parseConfig({ projects: { ABC: 'C:\\abc' }, modelPrompts: { sonnet: 'Old.' } })

  it('applies new chain rules and model prompts at once', () => {
    const next = parseConfig({ chain: { requiredLabels: ['Auto'] }, projects: { ABC: 'C:\\abc' }, modelPrompts: { opus: 'New.' } })
    const live = liveConfig(base, next)
    expect(live.rules.ABC?.requiredLabels).toEqual(['Auto'])
    expect(live.modelPrompts).toEqual({ opus: 'New.' })
    expect(restartChanges(base, next)).toEqual([])
  })

  it('keeps address, projects and context until a restart and names what waits for it', () => {
    const next = parseConfig({
      port: 5000,
      projects: { ABC: 'C:\\moved', XYZ: { repo: 'C:\\xyz', chain: { requiredLabels: ['Auto'] } } },
      context: { window: 1_000_000 },
    })
    const live = liveConfig(base, next)
    expect(live.port).toBe(4747)
    expect(live.projects).toEqual({ ABC: 'C:\\abc' })
    expect(live.rules).toEqual({ ABC: DEFAULT_RULES })
    expect(live.context).toEqual(base.context)
    expect(restartChanges(base, next)).toEqual(['port', 'projects', 'context'])
  })

  it('keeps the rules of a project the new file drops until a restart', () => {
    const shaped = parseConfig({ chain: { requiredLabels: ['Auto'] }, projects: { ABC: 'C:\\abc' } })
    const next = parseConfig({ projects: { XYZ: 'C:\\xyz' } })
    expect(liveConfig(shaped, next).rules).toEqual({ ABC: shaped.rules.ABC })
  })
})
