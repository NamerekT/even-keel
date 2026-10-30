import { describe, expect, it } from 'vitest'
import { formsOf, trackerChoices, withFeed, withNewProject, withoutFeed, withoutProject, withProjectForm, withRunAccount, withSharedAccount, withExecution, withSharedForm, withUpdates, withChainSwitches, withTally, yieldedMilestones } from './config-form.js'
import { parseConfig } from './config.js'
import type { ProjectDraft, ProjectForm, SharedForm } from './state.js'

const formOf = (raw: Record<string, unknown>, project: string): ProjectForm => formsOf(parseConfig(raw)).projects[project]!
const sharedOf = (raw: Record<string, unknown>): SharedForm => formsOf(parseConfig(raw)).shared
/** On Huly unless the fields name another tracker: a project's tracker is its own (BTN-345). */
const abc = (fields: Record<string, unknown> = {}) => ({ id: 'id-abc', key: 'ABC', tracker: 'huly', repo: 'C:\\abc', ...fields })
const xyz = (fields: Record<string, unknown> = {}) => ({ id: 'id-xyz', key: 'XYZ', tracker: 'huly', repo: 'C:\\xyz', ...fields })

describe('formsOf', () => {
  it('fills a project in with what it inherits', () => {
    const raw = { brief: false, chain: { requiredLabels: ['Auto'] }, projects: [abc({ tracker: 'github', github: 'octo-org/abc', slot: true })] }
    expect(formOf(raw, 'id-abc')).toMatchObject({
      repo: 'C:\\abc',
      branch: 'main',
      tracker: 'github',
      trackerProject: 'octo-org/abc',
      slot: 1,
      brief: false,
      chain: { active: null, terminal: null, requiredLabels: ['Auto'], excludedLabels: [] },
    })
    expect(formOf({ projects: [abc()] }, 'id-abc')).toMatchObject({ name: null, tracker: 'huly', trackerProject: null, slot: 0, brief: null })
  })

  it('names the project key of each tracker', () => {
    expect(trackerChoices()).toEqual([
      { name: 'huly', title: 'Huly', projectKey: { key: 'huly', example: 'ABC', optional: true, alias: true } },
      { name: 'github', title: 'GitHub', projectKey: { key: 'github', example: 'octo-org/example', optional: false, alias: false } },
      { name: 'linear', title: 'Linear', projectKey: { key: 'linear', example: 'Web app', optional: true, alias: false } },
      { name: 'gitlab', title: 'GitLab', projectKey: { key: 'gitlab', example: 'group/subgroup/project', optional: false, alias: false } },
      { name: 'jira', title: 'Jira', projectKey: null },
    ])
  })
})

describe('withProjectForm', () => {
  it('writes only what differs from what the project inherits, into the entry with the id', () => {
    const raw = { tracker: 'huly', projects: [abc(), xyz()], custom: 1 }
    const form: ProjectForm = {
      ...formOf(raw, 'id-abc'),
      repo: ' D:\\abc ',
      branch: 'master',
      tracker: 'github',
      trackerProject: 'octo-org/abc',
      slot: 3,
      brief: false,
      chain: { active: ['Todo', ' '], terminal: [], requiredLabels: [], excludedLabels: [] },
    }
    const next = withProjectForm(raw, 'id-abc', form, formOf(raw, 'id-abc'))
    expect(next).toEqual({
      tracker: 'huly',
      projects: [
        abc({ repo: 'D:\\abc', branch: 'master', slot: 3, tracker: 'github', brief: false, chain: { active: ['Todo'] }, github: 'octo-org/abc' }),
        xyz(),
      ],
      custom: 1,
    })
    expect(parseConfig(next).slots['id-abc']).toBe(3)
  })

  it('keeps keys the form leaves as they were, even when they repeat the shared value', () => {
    const entry = abc({ tracker: 'huly', slot: true, chain: { excludedLabels: ['Manual', 'Вручную'] } })
    const raw = { projects: [entry] }
    const form = { ...formOf(raw, 'id-abc'), prompt: 'Hi.' }
    expect(withProjectForm(raw, 'id-abc', form, formOf(raw, 'id-abc'))).toEqual({ projects: [{ ...entry, prompt: 'Hi.' }] })
  })

  it('removes the keys that go back to what is inherited, and the project key of the tracker left', () => {
    const raw = { brief: false, projects: [abc({ tracker: 'github', github: 'octo-org/abc', brief: true, slot: 2, chain: { requiredLabels: ['Auto'] } })] }
    const form: ProjectForm = { ...formOf(raw, 'id-abc'), tracker: 'huly', trackerProject: null, brief: false, slot: 0, chain: { active: null, terminal: null, requiredLabels: [], excludedLabels: [] } }
    expect(withProjectForm(raw, 'id-abc', form, formOf(raw, 'id-abc'))).toEqual({ brief: false, projects: [abc()] })
  })

  it('writes the tracker it moves to even when it is the default, so that no later default moves the project (BTN-345)', () => {
    const raw = { projects: [abc({ tracker: 'linear' })] }
    const form: ProjectForm = { ...formOf(raw, 'id-abc'), tracker: 'github', trackerProject: 'octo-org/abc' }
    expect(withProjectForm(raw, 'id-abc', form, formOf(raw, 'id-abc'))).toEqual({ projects: [abc({ tracker: 'github', github: 'octo-org/abc' })] })
  })

  it('writes null for statuses by category over a shared list', () => {
    const raw = { chain: { terminal: ['Done'] }, projects: [abc()] }
    const form = { ...formOf(raw, 'id-abc'), chain: { ...formOf(raw, 'id-abc').chain, terminal: [] } }
    const next = withProjectForm(raw, 'id-abc', form, formOf(raw, 'id-abc'))
    expect(next.projects).toEqual([abc({ chain: { terminal: null } })])
    expect(parseConfig(next).rules['id-abc']?.terminal).toBeNull()
  })

  it('names the rule keys the project sets itself', () => {
    expect(formOf({ chain: { requiredLabels: ['Auto'] }, projects: [abc({ chain: { terminal: ['Done'] } })] }, 'id-abc').ownRules).toEqual(['terminal'])
  })

  it('compares a changed rule with what the project inherits from its profile', () => {
    const raw = { chain: { active: ['Todo'] }, projects: [abc()] }
    const base = { ...formOf(raw, 'id-abc'), chain: { ...formOf(raw, 'id-abc').chain, active: ['Ready'] } }
    const shared = { ...base, chain: { ...base.chain, active: ['Todo'] } }
    expect(withProjectForm(raw, 'id-abc', shared, base, { active: ['Ready'] }).projects).toEqual([abc({ chain: { active: ['Todo'] } })])
    const own = { projects: [abc({ chain: { active: ['Mine'] } })] }
    const back = { ...formOf(own, 'id-abc'), chain: { ...formOf(own, 'id-abc').chain, active: ['Ready'] } }
    expect(withProjectForm(own, 'id-abc', back, formOf(own, 'id-abc'), { active: ['Ready'] }).projects).toEqual([abc()])
  })

  it('leaves a hand edit of the file alone where the form kept the value it started from', () => {
    const base = formOf({ projects: [abc()] }, 'id-abc')
    const entry = abc({ prompt: 'Hand.', slot: 2, branch: 'trunk', ci: { waitMinutes: 5 }, commands: { check: ['npm test'] } })
    const form: ProjectForm = { ...base, beforeStart: ['npm ci'], brief: false }
    expect(withProjectForm({ projects: [entry] }, 'id-abc', form, base)).toEqual({
      projects: [{ ...entry, commands: { check: ['npm test'], beforeStart: ['npm ci'] }, brief: false }],
    })
  })

  it('shows the color a project ends up with and writes a changed one as its own', () => {
    const raw = { projects: [abc(), xyz({ color: 1 })] }
    expect(formOf(raw, 'id-abc').color).toBe(2)
    expect(formOf({ projects: Array.from({ length: 9 }, (_, index) => abc({ id: `id-${index}`, key: `P${index}` })) }, 'id-8').color).toBeNull()
    const next = withProjectForm(raw, 'id-abc', { ...formOf(raw, 'id-abc'), color: 5 }, formOf(raw, 'id-abc'))
    expect(next.projects).toEqual([abc({ color: 5 }), xyz({ color: 1 })])
    expect(withProjectForm(raw, 'id-abc', { ...formOf(raw, 'id-abc'), prompt: 'Hi.' }, formOf(raw, 'id-abc')).projects).toEqual([abc({ prompt: 'Hi.' }), xyz({ color: 1 })])
  })

  it('writes a field changed both in the form and in the file over the file', () => {
    const base = formOf({ projects: [abc()] }, 'id-abc')
    const form: ProjectForm = { ...base, prompt: 'Mine.', slot: 4 }
    expect(withProjectForm({ projects: [abc({ prompt: 'Hand.', slot: 2 })] }, 'id-abc', form, base)).toEqual({ projects: [abc({ prompt: 'Mine.', slot: 4 })] })
  })

  it('writes the name of a project trimmed, and removes it when emptied', () => {
    const raw = { projects: [abc()] }
    const named = withProjectForm(raw, 'id-abc', { ...formOf(raw, 'id-abc'), name: '  Web shop ' }, formOf(raw, 'id-abc'))
    expect(named).toEqual({ projects: [abc({ name: 'Web shop' })] })
    expect(formOf(named, 'id-abc').name).toBe('Web shop')
    expect(withProjectForm(named, 'id-abc', { ...formOf(named, 'id-abc'), name: ' ' }, formOf(named, 'id-abc'))).toEqual({ projects: [abc()] })
  })

  it('takes each key Even Keel sets too from the project when it has one, else from the shared value', () => {
    const raw = {
      ci: { waitMinutes: 15, fixTask: true, kinds: ['github'] },
      fillMilestone: true,
      promptLanguage: 'ru',
      cacheTtl: '1h',
      stats: { checkpointTokens: 220_000 },
      projects: [abc({ ci: { waitMinutes: null, guard: false }, promptLanguage: 'en', stats: { checkpointTokens: 160_000 } }), xyz()],
    }
    const config = parseConfig(raw)
    expect(config.settings['id-abc']).toMatchObject({
      ci: { guard: false, kinds: ['github'], waitMinutes: null, recheckMain: true, fixTask: true },
      fillMilestone: true,
      promptLanguage: 'en',
      cacheTtl: '1h',
      checkpointTokens: 160_000,
      own: { 'ci.guard': false, 'ci.waitMinutes': null, promptLanguage: 'en', 'stats.checkpointTokens': 160_000 },
    })
    expect(config.settings['id-xyz']).toMatchObject({ ci: { guard: true, waitMinutes: 15, fixTask: true }, promptLanguage: 'ru', checkpointTokens: 220_000, own: {} })
  })

  it('writes an own value set back to "as shared" as a removed key, leaving the other own keys', () => {
    const raw = { ci: { waitMinutes: 15 }, projects: [abc({ ci: { waitMinutes: 5, guard: false }, cacheTtl: '5m' })] }
    const base = formOf(raw, 'id-abc')
    const form: ProjectForm = { ...base, own: { 'ci.guard': false, cacheTtl: '5m', fillMilestone: true } }
    expect(withProjectForm(raw, 'id-abc', form, base).projects).toEqual([abc({ ci: { guard: false }, cacheTtl: '5m', fillMilestone: true })])
  })

  it('refuses a project the config does not know', () => {
    const raw = { projects: [abc()] }
    expect(() => withProjectForm(raw, 'id-xyz', formOf(raw, 'id-abc'), formOf(raw, 'id-abc'))).toThrow(/id-xyz/)
  })
})

describe('withSharedForm', () => {
  it('writes what differs from the defaults and removes what goes back to them', () => {
    const raw = { projects: [abc()], models: { claude: 'sonnet' }, hiddenSkills: ['a'], custom: true, stats: { compare: { days: 14 }, extra: 1 } }
    const form: SharedForm = {
      ...sharedOf(raw),
      parallel: 2,
      models: { claude: 'opus', codex: ' gpt-6.1-sol ' },
      execution: { codex: 'bypass' },
      hiddenSkills: formsOf(parseConfig({ projects: [] })).shared.hiddenSkills,
      language: 'ru',
      promptLanguage: 'ru',
      allowedHosts: [' Box.Example.com '],
      context: { window: 1_000_000, warn: 50, danger: 80 },
      modelPrompts: { haiku: ' Be brief. ', sonnet: ' ' },
      chain: { active: null, terminal: null, requiredLabels: ['Auto'], excludedLabels: [] },
      stats: { ...sharedOf(raw).stats, compare: { minTasks: 5, minSessions: 10, days: 7 }, otherBelow: 2 },
      ci: { ...sharedOf(raw).ci, kinds: ['github'], waitMinutes: 15 },
      fillMilestone: true,
    }
    expect(withSharedForm(raw, form, sharedOf(raw))).toEqual({
      projects: [abc()],
      custom: true,
      parallel: 2,
      models: { codex: 'gpt-6.1-sol' },
      execution: { codex: 'bypass' },
      language: 'ru',
      allowedHosts: ['box.example.com'],
      context: { window: 1_000_000 },
      modelPrompts: { haiku: 'Be brief.' },
      chain: { requiredLabels: ['Auto'] },
      stats: { extra: 1, otherBelow: 2 },
      ci: { kinds: ['github'], waitMinutes: 15 },
      fillMilestone: true,
    })
  })

  it("writes Even Keel's prompt trimmed, removes a blank one and keeps a project's own", () => {
    const raw = { projects: [abc({ prompt: 'Own.' })] }
    const set = withSharedForm(raw, { ...sharedOf(raw), prompt: ' # Rules\n\n- Be brief. ' }, sharedOf(raw))
    expect(set).toEqual({ projects: [abc({ prompt: 'Own.' })], prompt: '# Rules\n\n- Be brief.' })
    expect(formsOf(parseConfig(set)).projects['id-abc']?.prompt).toBe('Own.')
    expect(withSharedForm(set, { ...sharedOf(set), prompt: ' ' }, sharedOf(set))).toEqual(raw)
  })

  it('keeps shared keys the form leaves as they were', () => {
    const raw = { projects: [], models: { claude: 'opus' }, parallel: 1, promptLanguage: 'en' }
    expect(withSharedForm(raw, sharedOf(raw), sharedOf(raw))).toEqual(raw)
  })

  it('leaves a hand edit of the file alone and writes a field changed in both over it', () => {
    const base = sharedOf({ projects: [] })
    const edited = { projects: [], model: 'opus', parallel: 2, chain: { requiredLabels: ['Auto'] } }
    const form: SharedForm = { ...base, parallel: 3, chain: { ...base.chain, excludedLabels: ['Later'] } }
    expect(withSharedForm(edited, form, base)).toEqual({ projects: [], model: 'opus', parallel: 3, chain: { requiredLabels: ['Auto'], excludedLabels: ['Later'] } })
  })

  it('writes the update switches', () => {
    const raw = { projects: [], updates: { notify: false } }
    const base = sharedOf(raw)
    expect(base.updates).toEqual({ check: true, notify: false })
    expect(withSharedForm(raw, { ...base, updates: { check: false, notify: true } }, base)).toEqual({ projects: [], updates: { check: false } })
    expect(withSharedForm({ projects: [], updates: { check: false } }, { ...base, updates: { check: true, notify: true } }, base)).toEqual({ projects: [] })
  })
})

describe('withUpdates', () => {
  it('sets the given update settings and removes what goes back to the defaults', () => {
    expect(withUpdates({ projects: [] }, { check: false })).toEqual({ projects: [], updates: { check: false } })
    expect(withUpdates({ projects: [], updates: { check: false } }, { notify: false })).toEqual({ projects: [], updates: { check: false, notify: false } })
    expect(withUpdates({ projects: [], updates: { notify: false } }, { notify: true })).toEqual({ projects: [] })
  })
})

describe('withChainSwitches', () => {
  it('sets the chain switches and removes what goes back to the defaults', () => {
    expect(withChainSwitches({ projects: [] }, { unattended: true })).toEqual({ projects: [], unattended: true })
    expect(withChainSwitches({ projects: [], unattended: true }, { trimTools: false })).toEqual({ projects: [], unattended: true, trimTools: false })
    expect(withChainSwitches({ projects: [], unattended: true, trimTools: false }, { unattended: false, trimTools: true })).toEqual({ projects: [] })
  })
})

describe('withTally', () => {
  it('sets where Tally writes, off included, and leaves the rest', () => {
    expect(withTally({ projects: [], unattended: true }, 'off')).toEqual({ projects: [], unattended: true, tally: 'off' })
    expect(withTally({ projects: [], tally: 'off' }, 'server')).toEqual({ projects: [], tally: 'server' })
  })
})

describe('withNewProject', () => {
  const draft: ProjectDraft = { repo: ' D:\\new ', branch: 'main', key: 'NEW', name: '', tracker: 'huly', trackerProject: '', profile: null, slot: 0, milestones: [], provider: null }

  it("writes the draft's agent only when it is not the shared one (BTN-310)", () => {
    expect((withNewProject({ projects: [] }, { ...draft, provider: 'codex' }, 'id-new').projects as Record<string, unknown>[])[0]).toMatchObject({ provider: 'codex' })
    expect((withNewProject({ provider: 'codex', projects: [] }, { ...draft, provider: 'codex' }, 'id-new').projects as Record<string, unknown>[])[0]).not.toHaveProperty('provider')
    expect((withNewProject({ projects: [] }, { ...draft, provider: 'claude' }, 'id-new').projects as Record<string, unknown>[])[0]).not.toHaveProperty('provider')
    expect(parseConfig(withNewProject({ projects: [] }, { ...draft, provider: 'codex' }, 'id-new')).settings['id-new']?.provider).toBe('codex')
  })

  it('appends an entry with only what differs from what the project would inherit', () => {
    const raw = { projects: [abc()], custom: 1 }
    const next = withNewProject(raw, draft, 'id-new')
    expect(next).toEqual({ projects: [abc(), { id: 'id-new', key: 'NEW', repo: 'D:\\new', tracker: 'huly', color: 2 }], custom: 1 })
    expect(parseConfig(next).projects).toEqual({ 'id-abc': 'C:\\abc', 'id-new': 'D:\\new' })
  })

  it('gives the new project the first color no project has', () => {
    const next = withNewProject({ projects: [abc({ color: 1 }), xyz({ color: 3 })] }, draft, 'id-new')
    expect((next.projects as Record<string, unknown>[])[2]).toMatchObject({ key: 'NEW', color: 2 })
    const full = { projects: Array.from({ length: 8 }, (_, index) => abc({ id: `id-${index}`, key: `P${index}`, color: index + 1 })) }
    expect((withNewProject(full, draft, 'id-new').projects as Record<string, unknown>[])[8]).not.toHaveProperty('color')
  })

  it('writes the name, the branch, the project in the tracker and the slots when they are the project own, and the tracker always (BTN-345)', () => {
    const next = withNewProject({ projects: [] }, { ...draft, name: ' New ', branch: 'master', tracker: 'github', trackerProject: ' octo-org/new ', slot: 2 }, 'id-new')
    expect(next.projects).toEqual([{ id: 'id-new', key: 'NEW', repo: 'D:\\new', name: 'New', branch: 'master', tracker: 'github', github: 'octo-org/new', slot: 2, color: 1 }])
    expect(withNewProject({ projects: [] }, { ...draft, tracker: 'github', trackerProject: 'octo-org/new' }, 'id-new').projects).toEqual([
      { id: 'id-new', key: 'NEW', repo: 'D:\\new', tracker: 'github', github: 'octo-org/new', color: 1 },
    ])
  })

  it('starts the list of projects in a config that has none', () => {
    expect(withNewProject({}, draft, 'id-new')).toEqual({ projects: [{ id: 'id-new', key: 'NEW', repo: 'D:\\new', tracker: 'huly', color: 1 }] })
  })

  it("splits a shared tracker project by the draft's milestones: they leave the projects on it (BTN-306)", () => {
    const release = { ...draft, key: 'ABC', milestones: [' v1.0.1 ', ''] }
    const raw = { projects: [abc({ chain: { excludedMilestones: ['v0.9'] } }), xyz()] }
    const next = withNewProject(raw, release, 'id-new')
    expect(next.projects).toEqual([abc({ chain: { excludedMilestones: ['v0.9', 'v1.0.1'] } }), xyz(), expect.objectContaining({ key: 'ABC', chain: { requiredMilestones: ['v1.0.1'] } })])
    expect(parseConfig(next).rules['id-new']?.requiredMilestones).toEqual(['v1.0.1'])
    expect(yieldedMilestones(raw, release, 'id-new')).toEqual({ 'id-abc': { excludedMilestones: ['v0.9', 'v1.0.1'] } })
  })

  it('takes the milestones out of the required ones of a project that names its own, and leaves one that splits already', () => {
    const release = { ...draft, key: 'ABC', milestones: ['V1.0.1'] }
    expect(yieldedMilestones({ projects: [abc({ chain: { requiredMilestones: ['v2', 'v1.0.1'] } })] }, release, 'id-new')).toEqual({ 'id-abc': { requiredMilestones: ['v2'] } })
    expect(yieldedMilestones({ projects: [abc({ chain: { requiredMilestones: ['v2'] } })] }, release, 'id-new')).toEqual({})
    expect(yieldedMilestones({ projects: [abc({ chain: { excludedMilestones: ['v1.0.1'] } })] }, release, 'id-new')).toEqual({})
    expect(yieldedMilestones({ projects: [abc()] }, { ...release, milestones: [] }, 'id-new')).toEqual({})
  })
})

describe('withoutProject', () => {
  it('drops the entry with the id and keeps the rest of the file', () => {
    expect(withoutProject({ projects: [abc(), xyz()], parallel: 2 }, 'id-abc')).toEqual({ projects: [xyz()], parallel: 2 })
  })

  it('refuses an id the file does not have', () => {
    expect(() => withoutProject({ projects: [abc()] }, 'id-xyz')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.unknownProject' }) }))
  })
})

describe('withFeed and withoutFeed (BTN-66)', () => {
  const feed = { id: 'feed-1', tracker: 'github', key: 'ABCGH', place: ' octo-org/ideas ' }

  it("appends the feed to the project's entry, its place under its tracker's project key", () => {
    const next = withFeed({ projects: [abc(), xyz()] }, 'id-abc', feed)
    expect(next.projects).toEqual([abc({ feeds: [{ id: 'feed-1', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas' }] }), xyz()])
    expect(parseConfig(next).feeds).toEqual({ 'id-abc': [{ id: 'feed-1', tracker: 'github', key: 'ABCGH', place: 'octo-org/ideas' }] })
  })

  it('writes no place that only repeats the key it stands in for', () => {
    const next = withFeed({ projects: [abc({ tracker: 'github', github: 'octo-org/abc' })] }, 'id-abc', { id: 'feed-1', tracker: 'huly', key: 'HUL', place: 'HUL' })
    expect(next.projects).toEqual([abc({ tracker: 'github', github: 'octo-org/abc', feeds: [{ id: 'feed-1', tracker: 'huly', key: 'HUL' }] })])
  })

  it('drops the feed with the id and the list once it is empty', () => {
    const raw = { projects: [abc({ feeds: [{ id: 'feed-1', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas' }] })] }
    expect(withoutFeed(raw, 'id-abc', 'feed-1')).toEqual({ projects: [abc()] })
    expect(() => withoutFeed(raw, 'id-abc', 'feed-2')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'config.unknownFeed' }) }))
  })
})

describe('withRunAccount', () => {
  const raw = { projects: [abc({ provider: 'claude', accounts: { claude: 'own' } })], accounts: { claude: 'work' } }

  it('moves the shared provider to the account and sets its pool entry, leaving projects alone', () => {
    const next = withRunAccount(raw, 'codex', 'codex')
    expect(next).toEqual({ ...raw, provider: 'codex', accounts: { claude: 'work' } })
    expect(parseConfig(next).provider).toBe('codex')
  })

  it('writes no provider for the default one and keeps the other providers entries', () => {
    expect(withRunAccount({ ...raw, provider: 'codex', accounts: { claude: 'work', codex: 'codex-2' } }, 'claude', 'second')).toEqual({
      ...raw,
      accounts: { claude: 'second', codex: 'codex-2' },
    })
  })
})

describe('withSharedAccount', () => {
  it("sets the shared pool's entry of the provider, leaving the shared provider and the projects alone", () => {
    const raw = { projects: [abc({ accounts: { codex: 'own' } })], accounts: { claude: 'work' } }
    const next = withSharedAccount(raw, 'codex', 'john')
    expect(next).toEqual({ ...raw, accounts: { claude: 'work', codex: 'john' } })
    expect(parseConfig(next).provider).toBe('claude')
  })
})

describe('withExecution', () => {
  it("sets the provider's execution mode alone, and drops it back to the default", () => {
    const raw = { projects: [abc()], execution: { codex: 'bypass' }, cli: { claude: 'checked' } }
    const next = withExecution(raw, 'claude', 'sdk')
    expect(next).toEqual({ ...raw, execution: { codex: 'bypass', claude: 'sdk' } })
    expect(parseConfig(next).execution).toEqual({ claude: 'sdk', codex: 'bypass' })
    expect(withExecution(next, 'claude', 'auto')).toEqual(raw)
  })
})
