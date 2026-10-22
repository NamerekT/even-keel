import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { parseConfig } from '../config.js'
import type { ProfileSet, TrackerProfile } from './model.js'
import { checkProfileRules, cleanRules, projectRules, rulesWith } from './rules.js'

const config = parseConfig({
  chain: { active: ['Todo'], requiredLabels: ['Agent'] },
  projects: [
    { id: 'abc', key: 'ABC', repo: 'C:\\abc' },
    { id: 'xyz', key: 'XYZ', repo: 'C:\\xyz', chain: { active: ['Ready'] } },
    { id: 'gh', key: 'GH', repo: 'C:\\gh', tracker: 'github', github: 'octo-org/example' },
  ],
})

const profile = (id: string, kind: string, rules?: TrackerProfile['rules']): TrackerProfile => ({
  id,
  kind,
  name: id,
  values: {},
  isDefault: true,
  login: null,
  expiresAt: null,
  ...(rules === undefined ? {} : { rules }),
})

describe('rules of a tracker profile (BTN-66)', () => {
  it('go between the shared rules and the keys a project sets itself', () => {
    expect(rulesWith(config.rules.abc!, config.ownRules.abc!, { active: ['Open'], terminal: ['Closed'] })).toEqual({
      ...DEFAULT_RULES,
      active: ['Open'],
      terminal: ['Closed'],
      requiredLabels: ['Agent'],
    })
    expect(rulesWith(config.rules.xyz!, config.ownRules.xyz!, { active: ['Open'], requiredLabels: [] })).toEqual({
      ...DEFAULT_RULES,
      active: ['Ready'],
      requiredLabels: [],
    })
    expect(rulesWith(config.rules.abc!, config.ownRules.abc!, undefined)).toBe(config.rules.abc)
  })

  it('are those of the profile the project runs on, its tracker\'s default without a link', () => {
    const set: ProfileSet = {
      profiles: [profile('huly-a', 'huly', { terminal: ['Shipped'] }), profile('github-a', 'github', { active: ['open'] }), { ...profile('huly-b', 'huly', { terminal: ['Gone'] }), isDefault: false }],
      links: { xyz: 'huly-b' },
    }
    expect(projectRules(config, set, 'abc').terminal).toEqual(['Shipped'])
    expect(projectRules(config, set, 'xyz').terminal).toEqual(['Gone'])
    expect(projectRules(config, set, 'gh')).toMatchObject({ active: ['open'], terminal: null })
  })

  it('refuse a change that puts a status on both sides for a project on the profile', () => {
    const set: ProfileSet = { profiles: [profile('huly-a', 'huly'), profile('github-a', 'github')], links: {} }
    expect(() => checkProfileRules(config, set, 'huly-a', { terminal: ['todo'] })).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.statusBoth', params: { project: 'ABC', status: 'Todo' } }) }))
    expect(() => checkProfileRules(config, set, 'huly-a', { terminal: ['Ready'] })).toThrow(/Ready/)
    expect(() => checkProfileRules(config, set, 'github-a', { terminal: ['Todo'] })).toThrow(/GH/)
    expect(() => checkProfileRules(config, set, 'huly-a', { excludedLabels: ['Agent'] })).toThrow(/Agent/)
    expect(() => checkProfileRules(config, set, 'huly-a', { active: ['Ready'], terminal: ['Done'] })).not.toThrow()
  })

  it('keep only the keys set, trimmed, without blanks and repeats', () => {
    expect(cleanRules({ active: [' Todo ', '', 'Todo'], terminal: null, requiredLabels: undefined })).toEqual({ active: ['Todo'], terminal: null })
  })
})
