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
  withProjectSettings,
} from './config.js'
import type { CiKind } from './ci/model.js'
import type { ProjectSettings } from './state.js'
import { DEFAULT_SHARES as SHARES } from './stats/checkpoint.js'
import { SCHEMA_VERSION } from './storage/schema.js'
import { DEFAULT_HIDDEN_SKILLS } from './tools/settings.js'

/**
 * Most cases here are about one field of a project, so they write `projects` keyed by the project key, each id the
 * same as its key: the maps of the config, by id, read as they would by key.
 */
const parse = (raw: Record<string, unknown>, adapters?: Parameters<typeof parseConfig>[1]) => {
  const { projects } = raw
  const listed =
    typeof projects === 'object' && projects !== null && !Array.isArray(projects)
      ? Object.entries(projects).map(([key, entry]) => ({ id: key, key, ...(typeof entry === 'object' ? entry : { repo: entry }) }))
      : projects
  return parseConfig({ ...raw, projects: listed }, adapters)
}

describe('projects in the config', () => {
  it('are a list of records in the order of the file, each with its id and key', () => {
    const config = parseConfig({
      projects: [
        { id: 'b3c1', key: 'XYZ', repo: 'C:\\xyz', name: 'Other' },
        { id: 'a7f0', key: 'ABC', repo: 'C:\\abc' },
      ],
    })
    expect(Object.keys(config.projects)).toEqual(['b3c1', 'a7f0'])
    expect(config.projects).toEqual({ b3c1: 'C:\\xyz', a7f0: 'C:\\abc' })
    expect(config.keys).toEqual({ b3c1: 'XYZ', a7f0: 'ABC' })
    expect(config.names).toEqual({ b3c1: 'Other' })
  })

  it('reject a map of projects, an entry that is not an object, and one without a key or with a malformed one', () => {
    expect(() => parseConfig({ projects: { ABC: 'C:\\abc' } })).toThrow(/projects/)
    expect(() => parseConfig({ projects: ['C:\\abc'] })).toThrow(/projects\[0\]/)
    expect(() => parseConfig({ projects: [{ id: 'a', repo: 'C:\\abc' }] })).toThrow(/projects\[0\]\.key/)
    expect(() => parseConfig({ projects: [{ id: 'a', key: 'abc', repo: 'C:\\abc' }] })).toThrow(/"abc"/)
  })

  it('reject an entry without an id: the service gives it one before it parses', () => {
    expect(() => parseConfig({ projects: [{ key: 'ABC', repo: 'C:\\abc' }] })).toThrow(/projects\[0\]\.id/)
    expect(() => parseConfig({ projects: [{ id: ' ', key: 'ABC', repo: 'C:\\abc' }] })).toThrow(/projects\[0\]\.id/)
  })

  it('reject two entries with one id, naming both places, but take two with one key (BTN-271)', () => {
    const twice = (a: object, b: object) => () => parseConfig({ projects: [{ repo: 'C:\\a', ...a }, { repo: 'C:\\b', ...b }] })
    expect(twice({ id: 'a', key: 'ABC' }, { id: 'a', key: 'XYZ' })).toThrow(/projects\[0\].*projects\[1\]/)
    const config = parseConfig({
      projects: [
        { id: 'a', key: 'ABC', repo: 'C:\\a', chain: { excludedMilestones: ['v1.0.1'] } },
        { id: 'b', key: 'ABC', repo: 'C:\\b', mergeInto: 'ABC', chain: { requiredMilestones: ['v1.0.1'] } },
      ],
    })
    expect(config.keys).toEqual({ a: 'ABC', b: 'ABC' })
    expect(config.settings.b?.mergeInto).toBe('a')
  })

  it('reject a schema version newer than this code knows', () => {
    expect(parseConfig({ version: SCHEMA_VERSION, projects: [] }).projects).toEqual({})
    expect(() => parseConfig({ version: SCHEMA_VERSION + 1, projects: [] })).toThrow(/newer version of Even Keel/)
    expect(() => parseConfig({ version: 'two', projects: [] })).toThrow(/version/)
  })
})

describe('withIds', () => {
  it('gives an id to each entry that has none, leaving the rest of the file as it is', () => {
    let next = 0
    const raw = { version: 2, brief: false, projects: [{ id: 'kept', key: 'ABC', repo: 'C:\\abc' }, { key: 'XYZ', repo: 'C:\\xyz' }] }
    const { raw: filled, keys } = withIds(raw, () => `new-${++next}`)
    expect(keys).toEqual(['XYZ'])
    expect(filled).toEqual({ ...raw, projects: [raw.projects[0], { id: 'new-1', key: 'XYZ', repo: 'C:\\xyz' }] })
    expect(raw.projects[1]).not.toHaveProperty('id')
  })

  it('returns the same file when every entry has an id or the projects are not a list', () => {
    const raw = { projects: [{ id: 'kept', key: 'ABC', repo: 'C:\\abc' }] }
    expect(withIds(raw, () => 'x')).toEqual({ raw, keys: [] })
    const old = { projects: { ABC: 'C:\\abc' } }
    expect(withIds(old, () => 'x')).toEqual({ raw: old, keys: [] })
  })
})

describe('parseConfig', () => {
  it('fills defaults when only projects are given', () => {
    const config = parse({ projects: { ABC: 'C:\\repos\\abc' } })
    expect(config).toEqual({
      allowedHosts: [],
      projects: { ABC: 'C:\\repos\\abc' },
      keys: { ABC: 'ABC' },
      names: {},
      rules: { ABC: DEFAULT_RULES },
      ownRules: { ABC: {} },
      slots: {},
      colors: { ABC: 1 },
      chain: DEFAULT_RULES,
      tracker: 'huly',
      trackers: { ABC: 'huly' },
      trackerProjects: {},
      feeds: {},
      brief: null,
      briefs: { ABC: null },
      settings: { ABC: { branch: 'main', prompt: null, beforeStart: [], check: [], afterGreen: [], ci: DEFAULT_CI, remoteProfiles: {}, pullRequests: false, mergeInto: null, fillMilestone: false, changelog: 'CHANGELOG.md', provider: null, models: {}, accounts: {}, modelLabels: null, promptLanguage: 'en', cacheTtl: null, checkpointTokens: null, checkpointShares: SHARES, own: {} } },
      ci: DEFAULT_CI,
      fillMilestone: false,
      context: { window: 600_000, warn: 50, danger: 80 },
      provider: 'claude',
      models: { claude: 'opus' },
      accounts: { claude: 'global', codex: 'codex' },
      execution: { codex: 'sandbox' },
      cli: { claude: 'checked', codex: 'checked' },
      modelLabels: false,
      modelPrompts: {},
      stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null, checkpointShares: SHARES },
      language: null,
      promptLanguage: 'en',
      hiddenSkills: DEFAULT_HIDDEN_SKILLS,
      cacheTtl: null,
      parallel: 1,
      updates: { check: true, notify: true },
      unattended: false,
      trimTools: true,
      tally: null,
    })
  })

  it('takes the release check and its toasts from updates', () => {
    expect(parse({ projects: {}, updates: { check: false } }).updates).toEqual({ check: false, notify: true })
    expect(parse({ projects: {}, updates: { notify: false } }).updates).toEqual({ check: true, notify: false })
    expect(() => parse({ projects: {}, updates: true })).toThrow(/updates must be an object/)
    expect(() => parse({ projects: {}, updates: { check: 'no' } })).toThrow(/updates\.check/)
    expect(() => parse({ projects: {}, updates: { dismissed: '0.2.0' } })).toThrow(/updates\.dismissed/)
    expect(() => parse({ projects: {}, updates: { channel: 'beta' } })).toThrow(/updates\.channel/)
  })

  it('takes the extra host names of the page as a list, trimmed and lowercase', () => {
    expect(parse({ projects: {}, allowedHosts: [' Pult.Example.com '] }).allowedHosts).toEqual(['pult.example.com'])
    expect(() => parse({ projects: {}, allowedHosts: 'pult.example.com' })).toThrow(/allowedHosts/)
    expect(() => parse({ projects: {}, allowedHosts: [''] })).toThrow(/allowedHosts/)
    expect(() => parse({ projects: {}, allowedHosts: ['https://pult.example.com'] })).toThrow(/allowedHosts/)
  })

  it('takes the number of chains run at once as a positive integer', () => {
    expect(parse({ projects: {}, parallel: 3 }).parallel).toBe(3)
    expect(() => parse({ projects: {}, parallel: 0 })).toThrow(/parallel/)
    expect(() => parse({ projects: {}, parallel: 1.5 })).toThrow(/parallel/)
    expect(() => parse({ projects: {}, parallel: '2' })).toThrow(/parallel/)
  })

  it('takes the skills hidden from chain sessions as a list of names', () => {
    expect(parse({ projects: {}, hiddenSkills: [' loop ', 'init'] }).hiddenSkills).toEqual(['loop', 'init'])
    expect(parse({ projects: {}, hiddenSkills: [] }).hiddenSkills).toEqual([])
    expect(() => parse({ projects: {}, hiddenSkills: 'loop' })).toThrow(/hiddenSkills/)
    expect(() => parse({ projects: {}, hiddenSkills: [''] })).toThrow(/hiddenSkills/)
  })

  it('takes the prompt language from its own key, else from the interface language', () => {
    expect(parse({ projects: {}, language: 'ru' })).toMatchObject({ language: 'ru', promptLanguage: 'ru' })
    expect(parse({ projects: {}, language: 'ru', promptLanguage: 'en' })).toMatchObject({ language: 'ru', promptLanguage: 'en' })
    expect(parse({ projects: {}, promptLanguage: 'ru' })).toMatchObject({ language: null, promptLanguage: 'ru' })
  })

  it('leaves the prompt cache TTL to the CLI unless it is 5m or 1h', () => {
    expect(parse({ projects: {} }).cacheTtl).toBeNull()
    expect(parse({ projects: {}, cacheTtl: '1h' }).cacheTtl).toBe('1h')
    expect(parse({ projects: {}, cacheTtl: '5m' }).cacheTtl).toBe('5m')
    expect(() => parse({ projects: {}, cacheTtl: '2h' })).toThrow(/cacheTtl.*"2h"/)
  })

  it('rejects a language it has no texts for', () => {
    expect(() => parse({ projects: {}, language: 'de' })).toThrow(/language.*"de".*en, ru/)
    expect(() => parse({ projects: {}, promptLanguage: 'RU' })).toThrow(/promptLanguage/)
  })

  it('takes the tracker of a project from its own key, else from the shared one', () => {
    const config = parse({ tracker: ' Fake ', projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', tracker: 'huly' } } }, { huly: {}, fake: {} })
    expect(config.tracker).toBe('fake')
    expect(config.trackers).toEqual({ ABC: 'fake', XYZ: 'huly' })
  })

  it('takes the name of a project in its tracker from the key the adapter asks for', () => {
    const config = parse({
      projects: { ABC: { repo: 'C:\\abc', tracker: 'github', github: 'octo-org/abc' }, XYZ: { repo: 'C:\\xyz', github: 'octo-org/xyz' } },
    })
    expect(config.trackerProjects).toEqual({ ABC: 'octo-org/abc' })
  })

  it('rejects a project on such a tracker without that name or with a malformed one', () => {
    expect(() => parse({ tracker: 'github', projects: { ABC: 'C:\\abc' } })).toThrow(/ABC\.github.*octo-org\/example/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', tracker: 'github', github: 'https://github.com/octo-org/abc' } } })).toThrow(/ABC\.github/)
  })

  it('lets a project leave out a key the adapter takes as optional, but not give a malformed one', () => {
    const config = parse({
      tracker: 'linear',
      projects: { ABC: { repo: 'C:\\abc', linear: ' Web app ' }, XYZ: 'C:\\xyz' },
    })
    expect(config.trackerProjects).toEqual({ ABC: 'Web app' })
    expect(() => parse({ tracker: 'linear', projects: { ABC: { repo: 'C:\\abc', linear: ' ' } } })).toThrow(/ABC\.linear/)
  })

  it('takes the extra task feeds of a project, checked by their trackers (BTN-66)', () => {
    const feed = { id: 'feed-1', tracker: 'github', key: 'ABCGH', github: ' octo-org/ideas ' }
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', feeds: [feed] }, XYZ: 'C:\\xyz' } })
    expect(config.feeds).toEqual({ ABC: [{ id: 'feed-1', tracker: 'github', key: 'ABCGH', place: 'octo-org/ideas' }] })
    const readers = readersOf(config)
    expect(readers.projects['feed-1']).toBe('C:\\abc')
    expect(ownerOf(readers, 'feed-1')).toBe('ABC')
    expect(ownerOf(readers, 'XYZ')).toBe('XYZ')
    expect(idPrefixOf(readers, 'feed-1')).toBe('ABCGH')
    expect(readerIds(config, 'ABC')).toEqual(['ABC', 'feed-1'])
    expect(readerOf(config, 'ABC', 'ABCGH-4')).toBe('feed-1')
    expect(readerOf(config, 'ABC', 'ABC-4')).toBe('ABC')
    expect(readerOf(config, 'XYZ', 'XYZ-4')).toBe('XYZ')
  })

  it('rejects a feed that is not an object, lacks its id or names an unknown tracker, a bad key or a bad place', () => {
    const feedOf = (feed: unknown) => () => parse({ projects: { ABC: { repo: 'C:\\abc', feeds: [feed] } } })
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', feeds: {} } } })).toThrow(/ABC\.feeds/)
    expect(feedOf('x')).toThrow(/ABC\.feeds/)
    expect(feedOf({ tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas' })).toThrow(/ABC\.feeds\[0\].*id/)
    expect(feedOf({ id: 'ABC', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas' })).toThrow(/ABC\.feeds\[0\]/)
    expect(feedOf({ id: 'f', tracker: 'jira', key: 'ABCGH' })).toThrow(/ABC\.feeds\[0\]\.tracker/)
    expect(feedOf({ id: 'f', tracker: 'github', key: 'abc', github: 'octo-org/ideas' })).toThrow(/ABC\.feeds\[0\]\.key/)
    expect(feedOf({ id: 'f', tracker: 'github', key: 'ABCGH', github: 'ideas' })).toThrow(/ABC\.feeds\[0\]\.github/)
  })

  it('rejects a feed whose task ids or place another project or feed has', () => {
    const projects = (feed: Record<string, unknown>) => ({ projects: { ABC: { repo: 'C:\\abc', feeds: [{ id: 'f', ...feed }] }, XYZ: 'C:\\xyz' } })
    expect(() => parse(projects({ tracker: 'github', key: 'XYZ', github: 'octo-org/ideas' }))).toThrow(/XYZ/)
    expect(() => parse(projects({ tracker: 'huly', key: 'ABCH', huly: 'XYZ' }))).toThrow(/XYZ/)
    expect(() =>
      parse({
        projects: {
          ABC: { repo: 'C:\\abc', feeds: [{ id: 'f', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas' }] },
          XYZ: { repo: 'C:\\xyz', feeds: [{ id: 'g', tracker: 'github', key: 'XYZGH', github: 'octo-org/ideas' }] },
        },
      }),
    ).toThrow(/ABC · ABCGH|XYZ · XYZGH/)
  })

  it('puts the task text into prompts unless brief is off, shared or per project', () => {
    const config = parse({
      brief: false,
      projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', brief: true }, QQ: { repo: 'C:\\qq' } },
    })
    expect(config.briefs).toEqual({ ABC: false, XYZ: true, QQ: false })
    expect(parse({ projects: { ABC: { repo: 'C:\\abc', brief: false } } }).briefs).toEqual({ ABC: false })
  })

  it('leaves brief to the packages when it is not set or null', () => {
    const config = parse({ projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', brief: null } } })
    expect(config.brief).toBeNull()
    expect(config.briefs).toEqual({ ABC: null, XYZ: null })
    expect(parse({ brief: false, projects: { ABC: { repo: 'C:\\abc', brief: null } } }).briefs).toEqual({ ABC: null })
  })

  it('takes a project\'s remote profiles by kind, trimmed, a blank one left out (BTN-231)', () => {
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', remoteProfiles: { github: ' org ', forgejo: '' } } } })
    expect(config.settings.ABC!.remoteProfiles).toEqual({ github: 'org' })
  })

  it('rejects remote profiles of an unknown kind or not a map', () => {
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', remoteProfiles: { gitlab: 'x' } } } })).toThrow(/ABC.remoteProfiles/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', remoteProfiles: ['x'] } } })).toThrow(/ABC.remoteProfiles/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', remoteProfiles: { github: 1 } } } })).toThrow(/ABC.remoteProfiles/)
  })

  it('rejects a brief that is not true, false or null', () => {
    expect(() => parse({ brief: 'no', projects: { ABC: 'C:\\abc' } })).toThrow(/brief/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', brief: 0 } } })).toThrow(/ABC.brief/)
  })

  it('takes a project prompt, the commands before start and the check commands, trimmed', () => {
    const config = parse({
      projects: {
        ABC: {
          repo: 'C:\\abc',
          prompt: '  Run npm test before merging.\n',
          commands: { beforeStart: [' npm ci ', '', 'npm run build'], check: [' npm test ', ''], afterGreen: ['npm run build', ' '] },
        },
        XYZ: 'C:\\xyz',
      },
    })
    expect(config.settings).toEqual({
      ABC: {
        branch: 'main',
        prompt: 'Run npm test before merging.',
        beforeStart: ['npm ci', 'npm run build'],
        check: ['npm test'],
        afterGreen: ['npm run build'],
        ci: DEFAULT_CI,
        remoteProfiles: {},
        pullRequests: false,
        mergeInto: null,
        fillMilestone: false,
        changelog: 'CHANGELOG.md',
        provider: null,
        models: {},
        accounts: {},
        modelLabels: null,
        promptLanguage: 'en',
        cacheTtl: null,
        checkpointTokens: null,
        checkpointShares: SHARES,
        own: {},
      },
      XYZ: {
        ...{ branch: 'main', prompt: null, beforeStart: [], check: [], afterGreen: [], ci: DEFAULT_CI, remoteProfiles: {}, pullRequests: false, mergeInto: null, fillMilestone: false, changelog: 'CHANGELOG.md' },
        ...{ provider: null, models: {}, accounts: {}, modelLabels: null, promptLanguage: 'en', cacheTtl: null, checkpointTokens: null, checkpointShares: SHARES, own: {} },
      },
    })
  })

  it('takes the changelog file inside the repository with any slashes and refuses one outside it', () => {
    expect(parse({ projects: { ABC: { repo: 'C:\\abc', changelog: '\\docs\\CHANGELOG.md/' } } }).settings.ABC?.changelog).toBe('docs/CHANGELOG.md')
    for (const changelog of ['../CHANGELOG.md', 'C:\\CHANGELOG.md', '  ', 7]) {
      expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', changelog } } })).toThrow(/ABC.changelog/)
    }
  })

  it('counts both CIs and waits for them as long as it takes unless the project says otherwise', () => {
    expect(DEFAULT_CI).toEqual({ guard: true, kinds: ['forgejo', 'github'], waitMinutes: null, recheckMain: true, fixTask: false })
    const config = parse({
      projects: {
        ABC: { repo: 'C:\\abc', ci: { kinds: ['github'], waitMinutes: 15 } },
        DEF: { repo: 'C:\\def', ci: { kinds: [], waitMinutes: 0, recheckMain: false, fixTask: true } },
        XYZ: { repo: 'C:\\xyz', ci: { waitMinutes: null } },
      },
    })
    expect(config.settings.ABC?.ci).toEqual({ guard: true, kinds: ['github'], waitMinutes: 15, recheckMain: true, fixTask: false })
    expect(config.settings.DEF?.ci).toEqual({ guard: true, kinds: [], waitMinutes: 0, recheckMain: false, fixTask: true })
    expect(config.settings.XYZ?.ci).toEqual(DEFAULT_CI)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: { recheckMain: 'no' } } } })).toThrow(/ABC.ci.recheckMain/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: { fixTask: 1 } } } })).toThrow(/ABC.ci.fixTask/)
  })

  it('turns the guard of main off only when the project says so, keeping the other CI keys', () => {
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', ci: { guard: false, kinds: ['github'], fixTask: true } } } })
    expect(config.settings.ABC?.ci).toEqual({ guard: false, kinds: ['github'], waitMinutes: null, recheckMain: true, fixTask: true })
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: { guard: 'off' } } } })).toThrow(/ABC.ci.guard/)
  })

  it('reads the name a project is shown by, trimmed; blank is no name', () => {
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', name: ' Web shop ' }, XYZ: { repo: 'C:\\xyz', name: '  ' }, OPS: 'C:\\ops' } })
    expect(config.names).toEqual({ ABC: 'Web shop' })
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', name: 5 } } })).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.projectName' }) }))
  })

  it('fills milestones only for a project that asks for it', () => {
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', fillMilestone: true }, XYZ: 'C:\\xyz' } })
    expect(config.settings.ABC?.fillMilestone).toBe(true)
    expect(config.settings.XYZ?.fillMilestone).toBe(false)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', fillMilestone: 'yes' } } })).toThrow(/ABC.fillMilestone/)
  })

  it('reads the run settings of a project by provider, trimmed, blank names left out', () => {
    const config = parse({
      projects: {
        ABC: { repo: 'C:\\abc', provider: ' Codex ', models: { codex: ' gpt-5.6-luna ', claude: ' ' }, accounts: { claude: 'team-api' }, modelLabels: true },
        XYZ: 'C:\\xyz',
      },
    })
    expect(config.settings.ABC).toMatchObject({ provider: 'codex', models: { codex: 'gpt-5.6-luna' }, accounts: { claude: 'team-api' }, modelLabels: true })
    expect(config.settings.XYZ).toMatchObject({ provider: null, models: {}, accounts: {}, modelLabels: null })
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', provider: 'gemini' } } })).toThrow(/ABC.provider.*gemini.*claude, codex/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', models: { gemini: 'pro' } } } })).toThrow(/ABC.models.gemini is not a provider/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', accounts: { claude: 5 } } } })).toThrow(/ABC.accounts.claude must be text/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', modelLabels: 'yes' } } })).toThrow(/ABC.modelLabels/)
  })

  it('reads the shared run settings over the defaults: Claude on opus in the global folder, Codex in its own, the sandbox on', () => {
    const config = parse({ projects: {}, provider: 'codex', models: { codex: 'gpt-5.6-sol' }, accounts: { claude: 'team-api' }, execution: { codex: 'bypass' }, modelLabels: true })
    expect(config).toMatchObject({
      provider: 'codex',
      models: { claude: 'opus', codex: 'gpt-5.6-sol' },
      accounts: { claude: 'team-api', codex: 'codex' },
      execution: { codex: 'bypass' },
      modelLabels: true,
    })
    expect(() => parse({ projects: {}, execution: { codex: 'yolo' } })).toThrow(/execution.codex.*yolo.*sandbox, bypass/)
    expect(() => parse({ projects: {}, execution: { claude: 'bypass' } })).toThrow(/execution.claude is not a provider/)
  })

  it('runs every provider on the checked CLI unless the config says system', () => {
    expect(parse({ projects: {} }).cli).toEqual({ claude: 'checked', codex: 'checked' })
    expect(parse({ projects: {}, cli: { codex: 'system' } }).cli).toEqual({ claude: 'checked', codex: 'system' })
    expect(() => parse({ projects: {}, cli: { claude: 'latest' } })).toThrow(/cli.claude.*latest.*checked, system/)
    expect(() => parse({ projects: {}, cli: { gemini: 'system' } })).toThrow(/cli.gemini is not a provider/)
  })

  it('fills the run settings of a project with the shared ones, entry by entry', () => {
    const config = parse({
      projects: { ABC: { repo: 'C:\\abc', provider: 'codex', models: { codex: 'gpt-5.6-luna' }, accounts: { claude: 'team-api' } }, XYZ: 'C:\\xyz' },
      models: { codex: 'gpt-5.6-sol' },
      modelLabels: true,
    })
    expect(runSettings(config, 'ABC')).toEqual({
      provider: 'codex',
      models: { claude: 'opus', codex: 'gpt-5.6-luna' },
      accounts: { claude: 'team-api', codex: 'codex' },
      labels: true,
    })
    expect(runSettings(config, 'XYZ')).toEqual({ provider: 'claude', models: { claude: 'opus', codex: 'gpt-5.6-sol' }, accounts: { claude: 'global', codex: 'codex' }, labels: true })
  })

  it('lists the pool entries, the shared ones and each project its own', () => {
    const config = parse({
      projects: { ABC: { repo: 'C:\\abc', provider: 'codex', accounts: { codex: 'codex-work' } }, XYZ: 'C:\\xyz' },
      accounts: { claude: 'work' },
    })
    expect(poolEntries(config, ['ABC', 'XYZ'])).toEqual([
      { project: null, provider: 'claude', account: 'work' },
      { project: null, provider: 'codex', account: 'codex' },
      { project: 'ABC', provider: 'codex', account: 'codex-work' },
    ])
  })

  it('tells which projects run on which account by their provider', () => {
    const config = parse({
      projects: {
        ABC: { repo: 'C:\\abc', provider: 'codex', accounts: { claude: 'team-api' } },
        DEF: { repo: 'C:\\def', accounts: { claude: 'team-api' } },
        XYZ: 'C:\\xyz',
      },
    })
    expect(projectsByAccount(config, ['ABC', 'DEF', 'XYZ'])).toEqual({ codex: ['ABC'], 'team-api': ['DEF'], global: ['XYZ'] })
  })

  it('rejects an unknown CI and a wait that is not whole minutes', () => {
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: [] } } })).toThrow(/ABC.ci/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: { kinds: ['jenkins'] } } } })).toThrow(/ABC.ci.kinds/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: { waitMinutes: -1 } } } })).toThrow(/ABC.ci.waitMinutes/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: { waitMinutes: 1.5 } } } })).toThrow(/ABC.ci.waitMinutes/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', ci: { other: 1 } } } })).toThrow(/other/)
  })

  it('reads an empty project prompt as no prompt', () => {
    expect(parse({ projects: { ABC: { repo: 'C:\\abc', prompt: '  ' } } }).settings.ABC?.prompt).toBeNull()
  })

  it('rejects a project prompt that is not text and commands that are not a list of strings', () => {
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', prompt: 1 } } })).toThrow(/ABC.prompt/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', commands: ['npm ci'] } } })).toThrow(/ABC.commands/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', commands: { beforeStart: 'npm ci' } } } })).toThrow(/ABC.commands.beforeStart/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', commands: { beforeStart: [1] } } } })).toThrow(/ABC.commands.beforeStart/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', commands: { afterAll: [] } } } })).toThrow(/afterAll/)
  })

  it('rejects a tracker it has no adapter for', () => {
    expect(() => parse({ tracker: 'jira', projects: { ABC: 'C:\\abc' } })).toThrow(/tracker "jira".*huly/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', tracker: 7 } } })).toThrow(/ABC.tracker/)
  })

  it('counts the standing slots of each project that works in them', () => {
    const config = parse({
      projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', slot: true }, QRS: { repo: 'C:\\qrs', slot: false }, DEF: { repo: 'C:\\def', slot: 2 } },
    })
    expect(config.slots).toEqual({ XYZ: 1, DEF: 2 })
    expect(config.projects).toEqual({ ABC: 'C:\\abc', XYZ: 'C:\\xyz', QRS: 'C:\\qrs', DEF: 'C:\\def' })
  })

  it('rejects a slot that is neither a flag nor a positive whole count', () => {
    for (const slot of ['yes', 0, -1, 1.5]) {
      expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', slot } } })).toThrow(/ABC.slot/)
    }
  })

  it('keeps the color a project has and gives one without the first color no project has, in the order of the file', () => {
    const config = parse({
      projects: { ABC: { repo: 'C:\\abc', color: 2 }, XYZ: 'C:\\xyz', QRS: 'C:\\qrs', DEF: { repo: 'C:\\def', color: 1 }, GHI: { repo: 'C:\\ghi', color: 2 } },
    })
    expect(config.colors).toEqual({ ABC: 2, XYZ: 3, QRS: 4, DEF: 1, GHI: 2 })
  })

  it('leaves a project without a color once all colors are taken', () => {
    const projects = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`P${index}`, `C:\\p${index}`]))
    const config = parse({ projects })
    expect(config.colors.P7).toBe(8)
    expect(config.colors.P8).toBeUndefined()
  })

  it('rejects a color that is not one of the eight', () => {
    for (const color of ['red', 0, 9, 1.5, null]) {
      expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', color } } })).toThrow(/ABC.color/)
    }
  })

  it('keeps model prompts keyed by the name of any model', () => {
    const config = parse({ projects: {}, modelPrompts: { sonnet: 'You are Sonnet.', 'gpt-5.6-sol': ' You are Sol. ' } })
    expect(config.modelPrompts).toEqual({ sonnet: 'You are Sonnet.', 'gpt-5.6-sol': 'You are Sol.' })
  })

  it('rejects a model prompt under a blank name or with an empty text', () => {
    expect(() => parse({ projects: {}, modelPrompts: { ' ': 'x' } })).toThrow(/modelPrompts/)
    expect(() => parse({ projects: {}, modelPrompts: { sonnet: ' ' } })).toThrow(/sonnet/)
    expect(() => parse({ projects: {}, modelPrompts: 'x' })).toThrow(/modelPrompts/)
  })

  it('rejects a model prompt with a substitution, since none is filled in', () => {
    expect(() => parse({ projects: {}, modelPrompts: { sonnet: 'Work on {task}.' } })).toThrow(/modelPrompts\.sonnet.*\{task\}/)
    expect(() => parse({ projects: {}, modelPrompts: { opus: 'Branch ${branch}.' } })).toThrow(/\$\{branch\}/)
  })

  it('takes the main branch of a project from its own key, main without one', () => {
    const config = parse({ projects: { ABC: { repo: 'C:\\abc', branch: ' master ' }, XYZ: 'C:\\xyz' } })
    expect(config.settings.ABC?.branch).toBe('master')
    expect(config.settings.XYZ?.branch).toBe('main')
  })

  it('rejects a main branch git would not take as a branch name', () => {
    for (const branch of ['', 'two words', '-x', 'a..b', 'a/', 'x.lock', 'a:b', 7]) {
      expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', branch } } })).toThrow(/ABC\.branch/)
    }
    expect(parse({ projects: { ABC: { repo: 'C:\\abc', branch: 'release/v1' } } }).settings.ABC?.branch).toBe('release/v1')
  })

  it('keeps the shared chain rules and brief next to the projects', () => {
    const config = parse({ chain: { requiredLabels: ['Auto'] }, brief: false, projects: {} })
    expect(config.chain).toEqual({ ...DEFAULT_RULES, requiredLabels: ['Auto'] })
    expect(config.brief).toBe(false)
  })

  it('reads no address from the file and names the keys it leaves out', () => {
    const raw = { host: '0.0.0.0', port: 5000, projects: {} }
    expect(parse(raw)).not.toHaveProperty('port')
    expect(ignoredKeys(raw)).toEqual(['host', 'port'])
    expect(ignoredKeys({ projects: {} })).toEqual([])
  })

  it('rejects a project key that is not a Huly identifier', () => {
    expect(() => parse({ projects: { 'bad key': 'C:\\x' } })).toThrow(/bad key/)
  })

  it('rejects an empty repository path', () => {
    expect(() => parse({ projects: { ABC: '' } })).toThrow(/ABC/)
  })

  it('rejects a missing projects map', () => {
    expect(() => parse({})).toThrow(/projects/)
  })
  it('keeps an explicit context scale', () => {
    const config = parse({ projects: {}, context: { window: 200_000, warn: 60, danger: 85 } })
    expect(config.context).toEqual({ window: 200_000, warn: 60, danger: 85 })
  })

  it('fills the missing parts of a context scale', () => {
    expect(parse({ projects: {}, context: { window: 1_000_000 } }).context).toEqual({
      window: 1_000_000,
      warn: 50,
      danger: 80,
    })
  })

  it('rejects a context window that is not a positive integer', () => {
    expect(() => parse({ projects: {}, context: { window: 0 } })).toThrow(/context.window/)
    expect(() => parse({ projects: {}, context: { window: 1.5 } })).toThrow(/context.window/)
  })

  it('rejects context thresholds outside 0..100 or out of order', () => {
    expect(() => parse({ projects: {}, context: { warn: 0 } })).toThrow(/context/)
    expect(() => parse({ projects: {}, context: { danger: 120 } })).toThrow(/context/)
    expect(() => parse({ projects: {}, context: { warn: 80, danger: 80 } })).toThrow(/context/)
  })

  it('rejects a context scale that is not an object', () => {
    expect(() => parse({ projects: {}, context: 600_000 })).toThrow(/context/)
  })

  it('fills the missing parts of the before and after comparison', () => {
    expect(parse({ projects: {}, stats: { compare: { days: 14 } } }).stats).toEqual({
      compare: { minTasks: 5, minSessions: 10, days: 14 },
      moves: {},
      otherBelow: 0,
      checkpointTokens: null,
      checkpointShares: SHARES,
    })
  })

  it('reads folder moves and the cost below which a folder goes to Other', () => {
    const stats = { moves: { 'D:/Old/tool': 'D:/New/tool' }, otherBelow: 25.5 }
    expect(parse({ projects: {}, stats }).stats).toMatchObject(stats)
  })

  it('rejects an empty move path and a negative or non-number Other threshold', () => {
    expect(() => parse({ projects: {}, stats: { moves: { 'D:/Old': '' } } })).toThrow(/stats.moves/)
    expect(() => parse({ projects: {}, stats: { moves: ['D:/Old'] } })).toThrow(/stats.moves/)
    expect(() => parse({ projects: {}, stats: { otherBelow: -1 } })).toThrow(/stats.otherBelow/)
    expect(() => parse({ projects: {}, stats: { otherBelow: '5' } })).toThrow(/stats.otherBelow/)
  })

  it('rejects comparison thresholds that are not positive integers', () => {
    expect(() => parse({ projects: {}, stats: { compare: { minTasks: 0 } } })).toThrow(/stats.compare.minTasks/)
    expect(() => parse({ projects: {}, stats: { compare: { days: 2.5 } } })).toThrow(/stats.compare.days/)
    expect(() => parse({ projects: {}, stats: { compare: { days: 400 } } })).toThrow(/stats.compare.days/)
    expect(() => parse({ projects: {}, stats: { compare: { window: 3 } } })).toThrow(/stats.compare.window/)
    expect(() => parse({ projects: {}, stats: [] })).toThrow(/stats/)
  })

  it('reads a pinned checkpoint threshold and rejects one the hook would never ask about', () => {
    expect(parse({ projects: {}, stats: { checkpointTokens: 180_000 } }).stats.checkpointTokens).toBe(180_000)
    expect(parse({ projects: {}, stats: { checkpointTokens: null } }).stats.checkpointTokens).toBeNull()
    expect(() => parse({ projects: {}, stats: { checkpointTokens: 99_999 } })).toThrow(/stats.checkpointTokens/)
    expect(() => parse({ projects: {}, stats: { checkpointTokens: 180_000.5 } })).toThrow(/stats.checkpointTokens/)
    expect(() => parse({ projects: {}, stats: { checkpointTokens: '180000' } })).toThrow(/stats.checkpointTokens/)
  })

  it('reads the window shares of the checkpoint thresholds, the own ones of a project over the shared ones', () => {
    const config = parse({
      stats: { checkpointShares: { first: 60 } },
      projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', stats: { checkpointShares: { late: 90, hard: 100 } } } },
    })
    expect(config.stats.checkpointShares).toEqual({ first: 60, late: 85, hard: 95 })
    expect(config.settings.ABC?.checkpointShares).toEqual({ first: 60, late: 85, hard: 95 })
    expect(config.settings.XYZ?.checkpointShares).toEqual({ first: 60, late: 90, hard: 100 })
    expect(config.settings.XYZ?.own).toEqual({ 'stats.checkpointShares.late': 90, 'stats.checkpointShares.hard': 100 })
  })

  it('rejects a share that is not a whole percent from 1 to 100, and an unknown one', () => {
    for (const first of [0, 101, 50.5, '50', null]) expect(() => parse({ projects: {}, stats: { checkpointShares: { first } } })).toThrow(/stats.checkpointShares.first/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', stats: { checkpointShares: { hard: 0 } } } } })).toThrow(/ABC.stats.checkpointShares.hard/)
    expect(() => parse({ projects: {}, stats: { checkpointShares: { middle: 80 } } })).toThrow(/stats.checkpointShares.middle/)
  })

  it('rejects shares out of order once those of a project are laid over the shared ones', () => {
    expect(() => parse({ projects: {}, stats: { checkpointShares: { first: 85 } } })).toThrow(/stats.checkpointShares.*85, 85, 95/)
    expect(() => parse({ projects: {}, stats: { checkpointShares: { late: 96 } } })).toThrow(/stats.checkpointShares/)
    const shared = { checkpointShares: { first: 50, late: 60 } }
    expect(() => parse({ stats: shared, projects: { ABC: { repo: 'C:\\abc', stats: { checkpointShares: { first: 70 } } } } })).toThrow(/ABC.stats.checkpointShares/)
    expect(parse({ stats: shared, projects: { ABC: { repo: 'C:\\abc', stats: { checkpointShares: { late: 80 } } } } }).settings.ABC?.checkpointShares).toEqual({ first: 50, late: 80, hard: 95 })
  })
})

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
      tracker: 'linear',
      projects: { GS: { repo: 'C:\\gs', linear: 'NAM/GameStore' }, NBC: { repo: 'C:\\nbc', linear: 'NAM/Business card' }, ENG: { repo: 'C:\\eng', linear: 'Web app' } },
    })
    expect(['GS', 'NBC', 'ENG'].map((project) => readKeyOf(config, project))).toEqual(['NAM/GameStore', 'NAM/Business card', 'ENG/Web app'])
    expect(['GS', 'NBC', 'ENG'].map((project) => idPrefixOf(config, project))).toEqual(['NAM', 'NAM', 'ENG'])
    expect(() => parse({ tracker: 'linear', projects: { GS: { repo: 'C:\\gs', linear: 'NAM/' }, NAM: 'C:\\nam' } })).toThrow(/NAM.*GS/)
  })

  it('read the key on a tracker whose value cannot be shared', () => {
    const config = parse({ tracker: 'github', projects: { ABC: { repo: 'C:\\abc', github: 'octo-org/abc' } } })
    expect(readKeyOf(config, 'ABC')).toBe('ABC')
  })

  it('reject two projects whose milestones do not split the tasks', () => {
    expect(() => parse({ projects: { ABC: 'C:\\abc', ABCR: release } })).toThrow(/ABCR.*ABC/)
    expect(() => parse({ projects: { ABC: { repo: 'C:\\abc', chain: { requiredMilestones: ['v1.0.1', 'v2'] } }, ABCR: release } })).toThrow(/ABCR.*ABC/)
  })
})

describe('projects of one key (BTN-271)', () => {
  const main = { id: 'f00d-1', key: 'ABC', repo: 'C:\\abc', chain: { excludedMilestones: ['v1.0.1'] } }
  const release = { id: 'beef-2', key: 'ABC', repo: 'C:\\abc-release', branch: 'release/v1', chain: { requiredMilestones: ['v1.0.1'] } }

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

describe('withProjectSettings', () => {
  const base: ProjectSettings = {
    ...{ branch: 'main', prompt: null, beforeStart: [], check: [], afterGreen: [], ci: DEFAULT_CI, remoteProfiles: {}, pullRequests: false, fillMilestone: false },
    ...{ changelog: 'CHANGELOG.md', provider: null, models: {}, accounts: {}, modelLabels: null, promptLanguage: 'en', cacheTtl: null, checkpointTokens: null, checkpointShares: SHARES, own: {} },
  }

  it('writes the main branch only when it is not main', () => {
    const settings = { ...base, branch: 'master' }
    expect(withProjectSettings('C:\\abc', settings)).toEqual({ repo: 'C:\\abc', branch: 'master' })
    expect(withProjectSettings({ repo: 'C:\\abc', branch: 'master' }, { ...settings, branch: ' main ' })).toEqual({ repo: 'C:\\abc' })
  })

  it('writes the own values of the keys Even Keel sets too, even one equal to the default, and removes the rest', () => {
    expect(withProjectSettings({ repo: 'C:\\abc', ci: { kinds: ['github'] }, fillMilestone: true }, base)).toEqual({ repo: 'C:\\abc' })
    const own = { 'ci.guard': true, 'ci.kinds': ['github', 'forgejo'] as CiKind[], 'ci.waitMinutes': null, fillMilestone: false, promptLanguage: 'ru' as const, cacheTtl: null, 'stats.checkpointTokens': 180_000 }
    expect(withProjectSettings('C:\\abc', { ...base, ci: { ...DEFAULT_CI, fixTask: true }, own })).toEqual({
      repo: 'C:\\abc',
      ci: { guard: true, kinds: ['forgejo', 'github'], waitMinutes: null },
      fillMilestone: false,
      promptLanguage: 'ru',
      cacheTtl: null,
      stats: { checkpointTokens: 180_000 },
    })
  })

  it('writes the own checkpoint shares under stats, next to the pinned threshold', () => {
    const own = { 'stats.checkpointTokens': 180_000, 'stats.checkpointShares.first': 60, 'stats.checkpointShares.hard': 90 }
    expect(withProjectSettings('C:\\abc', { ...base, own })).toEqual({ repo: 'C:\\abc', stats: { checkpointTokens: 180_000, checkpointShares: { first: 60, hard: 90 } } })
    expect(withProjectSettings({ repo: 'C:\\abc', stats: { checkpointShares: { late: 80 } } }, base)).toEqual({ repo: 'C:\\abc' })
  })

  it('writes an own key only when it changed', () => {
    const entry = { repo: 'C:\\abc', ci: { fixTask: true } }
    const settings = { ...base, own: { 'ci.guard': false } }
    expect(withProjectSettings(entry, settings, (field) => field === 'own.ci.guard')).toEqual({ repo: 'C:\\abc', ci: { fixTask: true, guard: false } })
  })

  it('writes the run settings the project has of its own, blank names left out', () => {
    const settings = { ...base, provider: 'codex', models: { codex: ' gpt-5.6-luna ', claude: ' ' }, accounts: { claude: 'team-api' }, modelLabels: false }
    expect(withProjectSettings('C:\\abc', settings)).toEqual({ repo: 'C:\\abc', provider: 'codex', models: { codex: 'gpt-5.6-luna' }, accounts: { claude: 'team-api' }, modelLabels: false })
    const inherited = { ...settings, provider: null, models: { codex: ' ' }, accounts: {}, modelLabels: null }
    expect(withProjectSettings({ repo: 'C:\\abc', provider: 'codex', models: { codex: 'x' }, accounts: { claude: 'y' }, modelLabels: true }, inherited)).toEqual({ repo: 'C:\\abc' })
  })

  it('writes the check commands and the commands after a green main next to the commands before start', () => {
    const settings = { ...base, beforeStart: ['npm ci'], check: [' npm test ', ''], afterGreen: ['npm run build '] }
    expect(withProjectSettings({ repo: 'C:\\abc', commands: { check: ['old'] } }, settings)).toEqual({
      repo: 'C:\\abc',
      commands: { beforeStart: ['npm ci'], check: ['npm test'], afterGreen: ['npm run build'] },
    })
    const none = { ...settings, beforeStart: [], check: [], afterGreen: [] }
    expect(withProjectSettings({ repo: 'C:\\abc', commands: { check: ['old'], afterGreen: ['old'] } }, none)).toEqual({ repo: 'C:\\abc' })
    expect(withProjectSettings({ repo: 'C:\\abc', commands: { afterGreen: ['old'] } }, none, (field) => field === 'afterGreen')).toEqual({ repo: 'C:\\abc' })
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
