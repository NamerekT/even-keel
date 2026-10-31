import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { parseConfig } from '../config.js'
import type { ProfileSet, TrackerProfile } from './model.js'
import { checkProfileRules, cleanRules, projectRules, rulesWith } from './rules.js'

const config = parseConfig({
  chain: { active: ['Todo'], requiredLabels: ['Agent'] },
  projects: [
    { id: 'abc', key: 'ABC', repo: 'C:\\abc', tracker: 'huly' },
    { id: 'xyz', key: 'XYZ', repo: 'C:\\xyz', tracker: 'huly', chain: { active: ['Ready'] } },
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

  it("are the feed's profile's for the tasks of a project's feed, and a change is checked against it too", () => {
    const fed = parseConfig({
      chain: { active: ['Todo'] },
      projects: [{ id: 'abc', key: 'ABC', repo: 'C:\\abc', tracker: 'huly', feeds: [{ id: 'feed', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas' }] }],
    })
    const feed = fed.feeds.abc![0]!
    const set: ProfileSet = {
      profiles: [profile('huly-a', 'huly', { terminal: ['Shipped'] }), profile('github-a', 'github', { active: ['open'] }), { ...profile('github-b', 'github', { active: ['ready'] }), isDefault: false }],
      links: {},
      feeds: { feed: 'github-b' },
    }
    expect(projectRules(fed, set, 'abc').terminal).toEqual(['Shipped'])
    expect(projectRules(fed, set, 'abc', feed).active).toEqual(['ready'])
    expect(() => checkProfileRules(fed, set, 'github-b', { terminal: ['Todo'] })).toThrow(/ABC · ABCGH/)
    expect(() => checkProfileRules(fed, set, 'github-a', { terminal: ['Todo'] })).not.toThrow()
  })

  it("of a feed are its own over its profile's and the shared ones, never the project's (BTN-553)", () => {
    const fed = parseConfig({
      chain: { active: ['Todo'], requiredLabels: ['Agent'] },
      projects: [
        {
          id: 'abc',
          key: 'ABC',
          repo: 'C:\\abc',
          tracker: 'huly',
          chain: { active: ['Ready'], excludedLabels: ['Later'] },
          feeds: [
            { id: 'own', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas', chain: { active: ['triage'], excludedMilestones: ['Someday'] } },
            { id: 'bare', tracker: 'linear', key: 'ABCLN', linear: 'ENG' },
          ],
        },
      ],
    })
    const [own, bare] = fed.feeds.abc!
    const set: ProfileSet = { profiles: [profile('github-a', 'github', { active: ['open'], terminal: ['closed'] }), profile('linear-a', 'linear')], links: {} }
    expect(projectRules(fed, set, 'abc', own)).toEqual({
      ...DEFAULT_RULES,
      active: ['triage'],
      terminal: ['closed'],
      requiredLabels: ['Agent'],
      excludedMilestones: ['Someday'],
    })
    expect(projectRules(fed, set, 'abc', bare)).toEqual({ ...DEFAULT_RULES, active: ['Todo'], requiredLabels: ['Agent'] })
    expect(projectRules(fed, set, 'abc')).toMatchObject({ active: ['Ready'], excludedLabels: ['Later'] })
  })

  it("refuse a feed whose own rules clash, named by the project and the feed's key", () => {
    const raw = (chain: unknown) => ({
      projects: [{ id: 'abc', key: 'ABC', repo: 'C:\\abc', tracker: 'huly', feeds: [{ id: 'feed', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas', chain }] }],
    })
    expect(() => parseConfig(raw({ active: ['open'], terminal: ['Open'] }))).toThrow(
      expect.objectContaining({ notice: expect.objectContaining({ code: 'config.statusBoth', params: { project: 'ABC · ABCGH', status: 'open' } }) }),
    )
    expect(() => parseConfig(raw({ requiredLabels: 'Agent' }))).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.feedRules' }) }))
    expect(() => parseConfig(raw({ colour: ['red'] }))).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.feedRules' }) }))
    expect(() => parseConfig(raw({ terminal: null }))).not.toThrow()
    const fed = parseConfig(raw({ active: ['ready'] }))
    const set: ProfileSet = { profiles: [profile('github-a', 'github')], links: {} }
    expect(() => checkProfileRules(fed, set, 'github-a', { terminal: ['Ready'] })).toThrow(/ABC · ABCGH/)
  })

  it('keep only the keys set, trimmed, without blanks and repeats', () => {
    expect(cleanRules({ active: [' Todo ', '', 'Todo'], terminal: null, requiredLabels: undefined })).toEqual({ active: ['Todo'], terminal: null })
  })
})
