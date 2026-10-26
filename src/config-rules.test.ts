import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from './chain/rules.js'
import {
  DEFAULT_CI,
  idPrefixOf,
  ignoredKeys,
  listenOf,
  ownerOf,
  parseConfig,
  poolEntries,
  projectLabels,
  projectsByAccount,
  readerIds,
  readerOf,
  readersOf,
  readKeyOf,
  runSettings,
  withIds,
} from './config.js'
import { DEFAULT_SHARES as SHARES } from './stats/checkpoint.js'
import { SCHEMA_VERSION } from './storage/schema.js'
import { DEFAULT_HIDDEN_SKILLS } from './tools/settings.js'

import { parse } from './config.fixture.js'

describe('chain rules in the config', () => {
  it('give every project the default rules when none are set', () => {
    expect(parse({ projects: { ABC: 'C:\\abc' } }).rules).toEqual({ ABC: DEFAULT_RULES })
  })

  it('take a project as an object with its repository and rules over the shared ones', () => {
    const config = parse({
      chain: { active: ['Todo', 'In Progress'], requiredLabels: ['Auto'] },
      projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', chain: { requiredLabels: [], terminal: ['Done'] } } },
    })
    expect(config.projects).toEqual({ ABC: 'C:\\abc', XYZ: 'C:\\xyz' })
    expect(config.rules.ABC).toEqual({ ...DEFAULT_RULES, active: ['Todo', 'In Progress'], requiredLabels: ['Auto'] })
    expect(config.rules.XYZ).toEqual({ ...DEFAULT_RULES, active: ['Todo', 'In Progress'], terminal: ['Done'], requiredLabels: [] })
  })

  it('trim the names it keeps', () => {
    expect(parse({ chain: { excludedLabels: [' Manual '] }, projects: { ABC: 'C:\\abc' } }).rules.ABC?.excludedLabels).toEqual(['Manual'])
  })

  it('reject a project object without a repository', () => {
    expect(() => parse({ projects: { ABC: { chain: {} } } })).toThrow(/ABC/)
  })

  it('reject a rule that is not a list of names', () => {
    expect(() => parse({ chain: { active: 'Todo' }, projects: {} })).toThrow(/chain.active/)
    expect(() => parse({ chain: { requiredLabels: ['Auto', ' '] }, projects: {} })).toThrow(/chain.requiredLabels/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', chain: { terminal: [1] } } } })).toThrow(/ABC.chain.terminal/)
    expect(() => parse({ chain: { activeStates: [] }, projects: {} })).toThrow(/activeStates/)
    expect(() => parse({ chain: [], projects: {} })).toThrow(/chain/)
  })

  it('reject a status that is both active and terminal', () => {
    expect(() =>
      parse({ chain: { active: ['Todo', 'In Review'] }, projects: { ABC: { repo: 'C:\\abc', chain: { terminal: [' in review '] } } } }),
    ).toThrow(/ABC.*in review/i)
  })

  it('reject a label that is both required and excluded', () => {
    expect(() => parse({ chain: { requiredLabels: ['Вручную'] }, projects: { ABC: 'C:\\abc' } })).toThrow(/ABC.*Вручную/)
  })

  it('reject a milestone that is both required and excluded', () => {
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', chain: { requiredMilestones: ['v1'], excludedMilestones: [' V1 '] } } } })).toThrow(/ABC.*v1/)
  })
})

describe('release projects', () => {
  it('merge into a main project', () => {
    const config = parse({ projects: { ABC: 'C:\\abc', ABCR: { repo: 'C:\\abc-release', mergeInto: ' ABC ' } } })
    expect(config.settings.ABCR?.mergeInto).toBe('ABC')
    expect(config.settings.ABC?.mergeInto).toBeNull()
  })

  it('refuse a project that is missing, itself or a release project', () => {
    expect(() => parse({ projects: { ABCR: { repo: 'C:\\r', mergeInto: 'ABC' } } })).toThrow(/ABCR.*ABC/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', mergeInto: 'ABC' } } })).toThrow(/ABC.*ABC/)
    expect(() => parse({ projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\x', mergeInto: 'ABC' }, ABCR: { repo: 'C:\\r', mergeInto: 'XYZ' } } })).toThrow(/ABCR.*XYZ/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', mergeInto: 5 } } })).toThrow(/ABC\.mergeInto/)
  })
})

describe('projects on one tracker project', () => {
  const release = { repo: 'C:\\abc-release', huly: 'ABC', chain: { requiredMilestones: ['v1.0.1'] } }

  it('read the Huly project the entry names, and their own key otherwise', () => {
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', chain: { excludedMilestones: ['v1.0.1'] } }, ABCR: release } })
    expect(config.trackerProjects).toEqual({ ABCR: 'ABC' })
    expect(readKeyOf(config, 'ABCR')).toBe('ABC')
    expect(readKeyOf(config, 'ABC')).toBe('ABC')
  })

  it('let a single project read a Huly project under another key', () => {
    expect(readKeyOf(parse({ projects: { ABC: { repo: 'C:\\abc', huly: 'XYZ' } } }), 'ABC')).toBe('XYZ')
    expect(readKeyOf(parse({ projects: { ABC: { repo: 'C:\\abc' } } }), 'ABC')).toBe('ABC')
  })

  it('let two projects read projects of one Linear team, under their own keys and the team prefix of ids', () => {
    const config = parse({
      projects: {
        GS: { repo: 'C:\\gs', tracker: 'linear', linear: 'NAM/GameStore' },
        NBC: { repo: 'C:\\nbc', tracker: 'linear', linear: 'NAM/Business card' },
        ENG: { repo: 'C:\\eng', tracker: 'linear', linear: 'Web app' },
      },
    })
    expect(['GS', 'NBC', 'ENG'].map((project) => readKeyOf(config, project))).toEqual(['NAM/GameStore', 'NAM/Business card', 'ENG/Web app'])
    expect(['GS', 'NBC', 'ENG'].map((project) => idPrefixOf(config, project))).toEqual(['NAM', 'NAM', 'ENG'])
    expect(() => parse({ projects: { GS: { repo: 'C:\\gs', tracker: 'linear', linear: 'NAM/' }, NAM: { repo: 'C:\\nam', tracker: 'linear' } } })).toThrow(/NAM.*GS/)
  })

  it('read the key on a tracker whose value cannot be shared', () => {
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', tracker: 'github', github: 'octo-org/abc' } } })
    expect(readKeyOf(config, 'ABC')).toBe('ABC')
  })

  it('reject two projects whose milestones do not split the tasks', () => {
    expect(() => parse({ projects: { ABC: 'C:\\abc', ABCR: release } })).toThrow(/ABCR.*ABC/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', chain: { requiredMilestones: ['v1.0.1', 'v2'] } }, ABCR: release } })).toThrow(/ABCR.*ABC/)
  })
})

describe('projects of one key (BTN-271)', () => {
  const main = { id: 'f00d-1', key: 'ABC', repo: 'C:\\abc', tracker: 'huly', chain: { excludedMilestones: ['v1.0.1'] } }
  const release = { id: 'beef-2', key: 'ABC', repo: 'C:\\abc-release', tracker: 'huly', branch: 'release/v1', chain: { requiredMilestones: ['v1.0.1'] } }

  it('read the tracker project of their key, and are told apart by name, then branch, then the start of the id', () => {
    const config = parseConfig({ projects: [main, release] })
    expect([readKeyOf(config, 'f00d-1'), readKeyOf(config, 'beef-2')]).toEqual(['ABC', 'ABC'])
    expect(projectLabels(config)).toEqual({ 'f00d-1': 'ABC (main)', 'beef-2': 'ABC (release/v1)' })
    const named = parseConfig({ projects: [{ ...main, name: 'Next' }, { ...release, branch: 'main', name: 'Next' }] })
    expect(projectLabels(named)).toEqual({ 'f00d-1': 'ABC (F00D)', 'beef-2': 'ABC (BEEF)' })
    const alone = parseConfig({ projects: [main, { ...release, key: 'XYZ' }] })
    expect(projectLabels(alone)).toEqual({ 'f00d-1': 'ABC', 'beef-2': 'XYZ' })
  })

  it('may share a GitHub repository, but not hold two: the ids of their tasks would clash', () => {
    const github = (repo: string) => ({ tracker: 'github', github: repo })
    expect(() => parseConfig({ projects: [{ ...main, ...github('octo-org/abc') }, { ...release, ...github('octo-org/abc') }] })).not.toThrow()
    expect(() => parseConfig({ projects: [{ ...main, ...github('octo-org/abc') }, { ...release, ...github('octo-org/other') }] })).toThrow(
      expect.objectContaining({ notice: expect.objectContaining({ code: 'config.keyElsewhere' }) }),
    )
  })
})


describe('listenOf', () => {
  it('takes the address from the environment, loopback and 4747 without it', () => {
    expect(listenOf({})).toEqual({ host: '127.0.0.1', port: 4747 })
    expect(listenOf({ EVEN_KEEL_HOST: ' 0.0.0.0 ', EVEN_KEEL_PORT: '5000' })).toEqual({ host: '0.0.0.0', port: 5000 })
    expect(listenOf({ EVEN_KEEL_HOST: '', EVEN_KEEL_PORT: ' ' })).toEqual({ host: '127.0.0.1', port: 4747 })
  })

  it('rejects a port outside the TCP range or not a whole number', () => {
    for (const port of ['70000', '0', '12.5', 'http']) expect(() => listenOf({ EVEN_KEEL_PORT: port })).toThrow(/EVEN_KEEL_PORT/)
  })
})
