import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from './chain/rules.js'
import { DEFAULT_CI, ignoredKeys, liveConfig, listenOf, parseConfig, restartChanges, withProjectSettings } from './config.js'
import { DEFAULT_HIDDEN_SKILLS } from './tools/settings.js'

describe('parseConfig', () => {
  it('fills defaults when only projects are given', () => {
    const config = parseConfig({ projects: { ABC: 'C:\\repos\\abc' } })
    expect(config).toEqual({
      allowedHosts: [],
      projects: { ABC: 'C:\\repos\\abc' },
      rules: { ABC: DEFAULT_RULES },
      slots: {},
      chain: DEFAULT_RULES,
      tracker: 'huly',
      trackers: { ABC: 'huly' },
      trackerProjects: {},
      brief: true,
      briefs: { ABC: true },
      settings: { ABC: { branch: 'main', prompt: null, beforeStart: [], check: [], ci: DEFAULT_CI, fillMilestone: false } },
      context: { window: 600_000, warn: 50, danger: 80 },
      model: 'opus',
      modelPrompts: {},
      stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null },
      language: null,
      promptLanguage: 'en',
      hiddenSkills: DEFAULT_HIDDEN_SKILLS,
      parallel: 1,
    })
  })

  it('takes the extra host names of the page as a list, trimmed and lowercase', () => {
    expect(parseConfig({ projects: {}, allowedHosts: [' Pult.Example.com '] }).allowedHosts).toEqual(['pult.example.com'])
    expect(() => parseConfig({ projects: {}, allowedHosts: 'pult.example.com' })).toThrow(/allowedHosts/)
    expect(() => parseConfig({ projects: {}, allowedHosts: [''] })).toThrow(/allowedHosts/)
    expect(() => parseConfig({ projects: {}, allowedHosts: ['https://pult.example.com'] })).toThrow(/allowedHosts/)
  })

  it('takes the number of chains run at once as a positive integer', () => {
    expect(parseConfig({ projects: {}, parallel: 3 }).parallel).toBe(3)
    expect(() => parseConfig({ projects: {}, parallel: 0 })).toThrow(/parallel/)
    expect(() => parseConfig({ projects: {}, parallel: 1.5 })).toThrow(/parallel/)
    expect(() => parseConfig({ projects: {}, parallel: '2' })).toThrow(/parallel/)
  })

  it('takes the skills hidden from chain sessions as a list of names', () => {
    expect(parseConfig({ projects: {}, hiddenSkills: [' loop ', 'init'] }).hiddenSkills).toEqual(['loop', 'init'])
    expect(parseConfig({ projects: {}, hiddenSkills: [] }).hiddenSkills).toEqual([])
    expect(() => parseConfig({ projects: {}, hiddenSkills: 'loop' })).toThrow(/hiddenSkills/)
    expect(() => parseConfig({ projects: {}, hiddenSkills: [''] })).toThrow(/hiddenSkills/)
  })

  it('takes the prompt language from its own key, else from the interface language', () => {
    expect(parseConfig({ projects: {}, language: 'ru' })).toMatchObject({ language: 'ru', promptLanguage: 'ru' })
    expect(parseConfig({ projects: {}, language: 'ru', promptLanguage: 'en' })).toMatchObject({ language: 'ru', promptLanguage: 'en' })
    expect(parseConfig({ projects: {}, promptLanguage: 'ru' })).toMatchObject({ language: null, promptLanguage: 'ru' })
  })

  it('rejects a language it has no texts for', () => {
    expect(() => parseConfig({ projects: {}, language: 'de' })).toThrow(/language.*"de".*en, ru/)
    expect(() => parseConfig({ projects: {}, promptLanguage: 'RU' })).toThrow(/promptLanguage/)
  })

  it('takes the tracker of a project from its own key, else from the shared one', () => {
    const config = parseConfig({ tracker: ' Fake ', projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', tracker: 'huly' } } }, { huly: {}, fake: {} })
    expect(config.tracker).toBe('fake')
    expect(config.trackers).toEqual({ ABC: 'fake', XYZ: 'huly' })
  })

  it('takes the name of a project in its tracker from the key the adapter asks for', () => {
    const config = parseConfig({
      projects: { ABC: { repo: 'C:\\abc', tracker: 'github', github: 'octo-org/abc' }, XYZ: { repo: 'C:\\xyz', github: 'octo-org/xyz' } },
    })
    expect(config.trackerProjects).toEqual({ ABC: 'octo-org/abc' })
  })

  it('rejects a project on such a tracker without that name or with a malformed one', () => {
    expect(() => parseConfig({ tracker: 'github', projects: { ABC: 'C:\\abc' } })).toThrow(/ABC\.github.*octo-org\/example/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', tracker: 'github', github: 'https://github.com/octo-org/abc' } } })).toThrow(/ABC\.github/)
  })

  it('lets a project leave out a key the adapter takes as optional, but not give a malformed one', () => {
    const config = parseConfig({
      tracker: 'linear',
      projects: { ABC: { repo: 'C:\\abc', linear: ' Web app ' }, XYZ: 'C:\\xyz' },
    })
    expect(config.trackerProjects).toEqual({ ABC: 'Web app' })
    expect(() => parseConfig({ tracker: 'linear', projects: { ABC: { repo: 'C:\\abc', linear: ' ' } } })).toThrow(/ABC\.linear/)
  })

  it('puts the task text into prompts unless brief is off, shared or per project', () => {
    const config = parseConfig({
      brief: false,
      projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', brief: true }, QQ: { repo: 'C:\\qq' } },
    })
    expect(config.briefs).toEqual({ ABC: false, XYZ: true, QQ: false })
    expect(parseConfig({ projects: { ABC: { repo: 'C:\\abc', brief: false } } }).briefs).toEqual({ ABC: false })
  })

  it('rejects a brief that is not true or false', () => {
    expect(() => parseConfig({ brief: 'no', projects: { ABC: 'C:\\abc' } })).toThrow(/brief/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', brief: 0 } } })).toThrow(/ABC.brief/)
  })

  it('takes a project prompt, the commands before start and the check commands, trimmed', () => {
    const config = parseConfig({
      projects: {
        ABC: {
          repo: 'C:\\abc',
          prompt: '  Run npm test before merging.\n',
          commands: { beforeStart: [' npm ci ', '', 'npm run build'], check: [' npm test ', ''] },
        },
        XYZ: 'C:\\xyz',
      },
    })
    expect(config.settings).toEqual({
      ABC: { branch: 'main', prompt: 'Run npm test before merging.', beforeStart: ['npm ci', 'npm run build'], check: ['npm test'], ci: DEFAULT_CI, fillMilestone: false },
      XYZ: { branch: 'main', prompt: null, beforeStart: [], check: [], ci: DEFAULT_CI, fillMilestone: false },
    })
  })

  it('counts both CIs and waits for them as long as it takes unless the project says otherwise', () => {
    expect(DEFAULT_CI).toEqual({ guard: true, kinds: ['forgejo', 'github'], waitMinutes: null, recheckMain: true, fixTask: false })
    const config = parseConfig({
      projects: {
        ABC: { repo: 'C:\\abc', ci: { kinds: ['github'], waitMinutes: 15 } },
        DEF: { repo: 'C:\\def', ci: { kinds: [], waitMinutes: 0, recheckMain: false, fixTask: true } },
        XYZ: { repo: 'C:\\xyz', ci: { waitMinutes: null } },
      },
    })
    expect(config.settings.ABC?.ci).toEqual({ guard: true, kinds: ['github'], waitMinutes: 15, recheckMain: true, fixTask: false })
    expect(config.settings.DEF?.ci).toEqual({ guard: true, kinds: [], waitMinutes: 0, recheckMain: false, fixTask: true })
    expect(config.settings.XYZ?.ci).toEqual(DEFAULT_CI)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { recheckMain: 'no' } } } })).toThrow(/ABC.ci.recheckMain/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { fixTask: 1 } } } })).toThrow(/ABC.ci.fixTask/)
  })

  it('turns the guard of main off only when the project says so, keeping the other CI keys', () => {
    const config = parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { guard: false, kinds: ['github'], fixTask: true } } } })
    expect(config.settings.ABC?.ci).toEqual({ guard: false, kinds: ['github'], waitMinutes: null, recheckMain: true, fixTask: true })
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { guard: 'off' } } } })).toThrow(/ABC.ci.guard/)
  })

  it('fills milestones only for a project that asks for it', () => {
    const config = parseConfig({ projects: { ABC: { repo: 'C:\\abc', fillMilestone: true }, XYZ: 'C:\\xyz' } })
    expect(config.settings.ABC?.fillMilestone).toBe(true)
    expect(config.settings.XYZ?.fillMilestone).toBe(false)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', fillMilestone: 'yes' } } })).toThrow(/ABC.fillMilestone/)
  })

  it('rejects an unknown CI and a wait that is not whole minutes', () => {
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: [] } } })).toThrow(/ABC.ci/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { kinds: ['jenkins'] } } } })).toThrow(/ABC.ci.kinds/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { waitMinutes: -1 } } } })).toThrow(/ABC.ci.waitMinutes/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { waitMinutes: 1.5 } } } })).toThrow(/ABC.ci.waitMinutes/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', ci: { other: 1 } } } })).toThrow(/other/)
  })

  it('reads an empty project prompt as no prompt', () => {
    expect(parseConfig({ projects: { ABC: { repo: 'C:\\abc', prompt: '  ' } } }).settings.ABC?.prompt).toBeNull()
  })

  it('rejects a project prompt that is not text and commands that are not a list of strings', () => {
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', prompt: 1 } } })).toThrow(/ABC.prompt/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', commands: ['npm ci'] } } })).toThrow(/ABC.commands/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', commands: { beforeStart: 'npm ci' } } } })).toThrow(/ABC.commands.beforeStart/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', commands: { beforeStart: [1] } } } })).toThrow(/ABC.commands.beforeStart/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', commands: { afterAll: [] } } } })).toThrow(/afterAll/)
  })

  it('rejects a tracker it has no adapter for', () => {
    expect(() => parseConfig({ tracker: 'jira', projects: { ABC: 'C:\\abc' } })).toThrow(/tracker "jira".*huly/)
    expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', tracker: 7 } } })).toThrow(/ABC.tracker/)
  })

  it('counts the standing slots of each project that works in them', () => {
    const config = parseConfig({
      projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', slot: true }, QRS: { repo: 'C:\\qrs', slot: false }, DEF: { repo: 'C:\\def', slot: 2 } },
    })
    expect(config.slots).toEqual({ XYZ: 1, DEF: 2 })
    expect(config.projects).toEqual({ ABC: 'C:\\abc', XYZ: 'C:\\xyz', QRS: 'C:\\qrs', DEF: 'C:\\def' })
  })

  it('rejects a slot that is neither a flag nor a positive whole count', () => {
    for (const slot of ['yes', 0, -1, 1.5]) {
      expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', slot } } })).toThrow(/ABC.slot/)
    }
  })

  it('takes the default model as an alias, in any case', () => {
    expect(parseConfig({ projects: {}, model: ' Sonnet ' }).model).toBe('sonnet')
  })

  it('rejects a default model that is not an alias', () => {
    expect(() => parseConfig({ projects: {}, model: 'claude-opus-5-5' })).toThrow(/model.*claude-opus-5-5.*sonnet, opus, haiku/)
    expect(() => parseConfig({ projects: {}, model: 5 })).toThrow(/model/)
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

  it('rejects a model prompt with a substitution, since none is filled in', () => {
    expect(() => parseConfig({ projects: {}, modelPrompts: { sonnet: 'Work on {task}.' } })).toThrow(/modelPrompts\.sonnet.*\{task\}/)
    expect(() => parseConfig({ projects: {}, modelPrompts: { opus: 'Branch ${branch}.' } })).toThrow(/\$\{branch\}/)
  })

  it('takes the main branch of a project from its own key, main without one', () => {
    const config = parseConfig({ projects: { ABC: { repo: 'C:\\abc', branch: ' master ' }, XYZ: 'C:\\xyz' } })
    expect(config.settings.ABC?.branch).toBe('master')
    expect(config.settings.XYZ?.branch).toBe('main')
  })

  it('rejects a main branch git would not take as a branch name', () => {
    for (const branch of ['', 'two words', '-x', 'a..b', 'a/', 'x.lock', 'a:b', 7]) {
      expect(() => parseConfig({ projects: { ABC: { repo: 'C:\\abc', branch } } })).toThrow(/ABC\.branch/)
    }
    expect(parseConfig({ projects: { ABC: { repo: 'C:\\abc', branch: 'release/v1' } } }).settings.ABC?.branch).toBe('release/v1')
  })

  it('keeps the shared chain rules and brief next to the projects', () => {
    const config = parseConfig({ chain: { requiredLabels: ['Auto'] }, brief: false, projects: {} })
    expect(config.chain).toEqual({ ...DEFAULT_RULES, requiredLabels: ['Auto'] })
    expect(config.brief).toBe(false)
  })

  it('reads no address from the file and names the keys it leaves out', () => {
    const raw = { host: '0.0.0.0', port: 5000, projects: {} }
    expect(parseConfig(raw)).not.toHaveProperty('port')
    expect(ignoredKeys(raw)).toEqual(['host', 'port'])
    expect(ignoredKeys({ projects: {} })).toEqual([])
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

  it('fills the missing parts of the before and after comparison', () => {
    expect(parseConfig({ projects: {}, stats: { compare: { days: 14 } } }).stats).toEqual({
      compare: { minTasks: 5, minSessions: 10, days: 14 },
      moves: {},
      otherBelow: 0,
      checkpointTokens: null,
    })
  })

  it('reads folder moves and the cost below which a folder goes to Other', () => {
    const stats = { moves: { 'D:/Old/tool': 'D:/New/tool' }, otherBelow: 25.5 }
    expect(parseConfig({ projects: {}, stats }).stats).toMatchObject(stats)
  })

  it('rejects an empty move path and a negative or non-number Other threshold', () => {
    expect(() => parseConfig({ projects: {}, stats: { moves: { 'D:/Old': '' } } })).toThrow(/stats.moves/)
    expect(() => parseConfig({ projects: {}, stats: { moves: ['D:/Old'] } })).toThrow(/stats.moves/)
    expect(() => parseConfig({ projects: {}, stats: { otherBelow: -1 } })).toThrow(/stats.otherBelow/)
    expect(() => parseConfig({ projects: {}, stats: { otherBelow: '5' } })).toThrow(/stats.otherBelow/)
  })

  it('rejects comparison thresholds that are not positive integers', () => {
    expect(() => parseConfig({ projects: {}, stats: { compare: { minTasks: 0 } } })).toThrow(/stats.compare.minTasks/)
    expect(() => parseConfig({ projects: {}, stats: { compare: { days: 2.5 } } })).toThrow(/stats.compare.days/)
    expect(() => parseConfig({ projects: {}, stats: { compare: { days: 400 } } })).toThrow(/stats.compare.days/)
    expect(() => parseConfig({ projects: {}, stats: { compare: { window: 3 } } })).toThrow(/stats.compare.window/)
    expect(() => parseConfig({ projects: {}, stats: [] })).toThrow(/stats/)
  })

  it('reads a pinned checkpoint threshold and rejects one the hook would never ask about', () => {
    expect(parseConfig({ projects: {}, stats: { checkpointTokens: 180_000 } }).stats.checkpointTokens).toBe(180_000)
    expect(parseConfig({ projects: {}, stats: { checkpointTokens: null } }).stats.checkpointTokens).toBeNull()
    expect(() => parseConfig({ projects: {}, stats: { checkpointTokens: 99_999 } })).toThrow(/stats.checkpointTokens/)
    expect(() => parseConfig({ projects: {}, stats: { checkpointTokens: 180_000.5 } })).toThrow(/stats.checkpointTokens/)
    expect(() => parseConfig({ projects: {}, stats: { checkpointTokens: '180000' } })).toThrow(/stats.checkpointTokens/)
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

  it('applies new chain rules, the default model and model prompts at once', () => {
    const next = parseConfig({ chain: { requiredLabels: ['Auto'] }, projects: { ABC: 'C:\\abc' }, model: 'sonnet', modelPrompts: { opus: 'New.' } })
    const live = liveConfig(base, { ...next, stats: { compare: { minTasks: 3, minSessions: 6, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null } })
    expect(live.rules.ABC?.requiredLabels).toEqual(['Auto'])
    expect(live.model).toBe('sonnet')
    expect(live.modelPrompts).toEqual({ opus: 'New.' })
    expect(live.stats.compare.minTasks).toBe(3)
    expect(restartChanges(base, next)).toEqual([])
  })

  it('applies the hidden skills at once', () => {
    const next = parseConfig({ projects: { ABC: 'C:\\abc' }, hiddenSkills: ['loop'] })
    expect(liveConfig(base, next).hiddenSkills).toEqual(['loop'])
    expect(restartChanges(base, next)).toEqual([])
  })

  it('applies the allowed host names at once', () => {
    const next = parseConfig({ projects: { ABC: 'C:\\abc' }, allowedHosts: ['pult.example.com'] })
    expect(liveConfig(base, next).allowedHosts).toEqual(['pult.example.com'])
    expect(restartChanges(base, next)).toEqual([])
  })

  it('applies the number of parallel chains at once', () => {
    const next = parseConfig({ projects: { ABC: 'C:\\abc' }, parallel: 2 })
    expect(liveConfig(base, next).parallel).toBe(2)
    expect(restartChanges(base, next)).toEqual([])
  })

  it('applies brief at once', () => {
    const next = parseConfig({ projects: { ABC: { repo: 'C:\\abc', brief: false } } })
    expect(liveConfig(base, next).briefs).toEqual({ ABC: false })
    expect(restartChanges(base, next)).toEqual([])
  })

  it('applies the project prompt and the commands before start at once', () => {
    const next = parseConfig({ projects: { ABC: { repo: 'C:\\abc', prompt: 'Mind Library.', commands: { beforeStart: ['npm ci'] } } } })
    expect(liveConfig(base, next).settings).toEqual({ ABC: { branch: 'main', prompt: 'Mind Library.', beforeStart: ['npm ci'], check: [], ci: DEFAULT_CI, fillMilestone: false } })
    expect(restartChanges(base, next)).toEqual([])
  })

  it('applies the main branch and the shared rules at once', () => {
    const next = parseConfig({ brief: false, chain: { requiredLabels: ['Auto'] }, projects: { ABC: { repo: 'C:\\abc', branch: 'master' } } })
    expect(liveConfig(base, next)).toMatchObject({ brief: false, chain: { requiredLabels: ['Auto'] }, settings: { ABC: { branch: 'master' } } })
    expect(restartChanges(base, next)).toEqual([])
  })

  it('applies the languages at once', () => {
    const next = parseConfig({ projects: { ABC: 'C:\\abc' }, language: 'ru', promptLanguage: 'en' })
    expect(liveConfig(base, next)).toMatchObject({ language: 'ru', promptLanguage: 'en' })
    expect(restartChanges(base, next)).toEqual([])
  })

  it('keeps projects and context until a restart and names what waits for it', () => {
    const next = parseConfig({
      projects: { ABC: 'C:\\moved', XYZ: { repo: 'C:\\xyz', chain: { requiredLabels: ['Auto'] } } },
      context: { window: 1_000_000 },
    })
    const live = liveConfig(base, next)
    expect(live.projects).toEqual({ ABC: 'C:\\abc' })
    expect(live.rules).toEqual({ ABC: DEFAULT_RULES })
    expect(live.context).toEqual(base.context)
    expect(live.trackers).toEqual({ ABC: 'huly' })
    expect(restartChanges(base, next)).toEqual(['projects', 'trackers', 'context'])
  })

  it('keeps the rules of a project the new file drops until a restart', () => {
    const shaped = parseConfig({ chain: { requiredLabels: ['Auto'] }, projects: { ABC: 'C:\\abc' } })
    const next = parseConfig({ projects: { XYZ: 'C:\\xyz' } })
    expect(liveConfig(shaped, next).rules).toEqual({ ABC: shaped.rules.ABC })
  })
})

describe('withProjectSettings', () => {
  it('writes the main branch only when it is not main', () => {
    const settings = { branch: 'master', prompt: null, beforeStart: [], check: [], ci: DEFAULT_CI, fillMilestone: false }
    expect(withProjectSettings('C:\\abc', settings)).toEqual({ repo: 'C:\\abc', branch: 'master' })
    expect(withProjectSettings({ repo: 'C:\\abc', branch: 'master' }, { ...settings, branch: ' main ' })).toEqual({ repo: 'C:\\abc' })
  })

  it('writes the CI settings only when they differ from the default, keeping the other keys', () => {
    const settings = { branch: 'main', prompt: null, beforeStart: [], check: [], ci: DEFAULT_CI, fillMilestone: false }
    expect(withProjectSettings({ repo: 'C:\\abc', ci: { kinds: ['github'] } }, settings)).toEqual({ repo: 'C:\\abc' })
    expect(withProjectSettings('C:\\abc', { ...settings, ci: { guard: true, kinds: ['github', 'forgejo'], waitMinutes: 10, recheckMain: true, fixTask: false } })).toEqual({
      repo: 'C:\\abc',
      ci: { waitMinutes: 10 },
    })
    expect(withProjectSettings('C:\\abc', { ...settings, ci: { guard: true, kinds: [], waitMinutes: null, recheckMain: false, fixTask: true } })).toEqual({
      repo: 'C:\\abc',
      ci: { kinds: [], recheckMain: false, fixTask: true },
    })
  })

  it('writes the guard of main only when it is off, and keeps the CI keys it covers', () => {
    const settings = { branch: 'main', prompt: null, beforeStart: [], check: ['npm test'], ci: { ...DEFAULT_CI, guard: false, waitMinutes: 10 }, fillMilestone: false }
    expect(withProjectSettings('C:\\abc', settings)).toEqual({ repo: 'C:\\abc', commands: { check: ['npm test'] }, ci: { guard: false, waitMinutes: 10 } })
    expect(withProjectSettings({ repo: 'C:\\abc', ci: { guard: false } }, { ...settings, check: [], ci: DEFAULT_CI })).toEqual({ repo: 'C:\\abc' })
  })

  it('writes the milestone switch only when it is on', () => {
    const settings = { branch: 'main', prompt: null, beforeStart: [], check: [], ci: DEFAULT_CI, fillMilestone: true }
    expect(withProjectSettings('C:\\abc', settings)).toEqual({ repo: 'C:\\abc', fillMilestone: true })
    expect(withProjectSettings({ repo: 'C:\\abc', fillMilestone: true }, { ...settings, fillMilestone: false })).toEqual({ repo: 'C:\\abc' })
  })

  it('writes the check commands next to the commands before start', () => {
    const settings = { branch: 'main', prompt: null, beforeStart: ['npm ci'], check: [' npm test ', ''], ci: DEFAULT_CI, fillMilestone: false }
    expect(withProjectSettings({ repo: 'C:\\abc', commands: { check: ['old'] } }, settings)).toEqual({
      repo: 'C:\\abc',
      commands: { beforeStart: ['npm ci'], check: ['npm test'] },
    })
    expect(withProjectSettings({ repo: 'C:\\abc', commands: { check: ['old'] } }, { ...settings, beforeStart: [], check: [] })).toEqual({ repo: 'C:\\abc' })
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
