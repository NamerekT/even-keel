import { describe, expect, it } from 'vitest'
import { formsOf, trackerChoices, withNewProject, withoutProject, withProjectForm, withRunAccount, withSharedForm, withUpdates, withChainSwitches } from './config-form.js'
import { parseConfig } from './config.js'
import type { ProjectDraft, ProjectForm, SharedForm } from './state.js'

const formOf = (raw: Record<string, unknown>, project: string): ProjectForm => formsOf(parseConfig(raw)).projects[project]!
const sharedOf = (raw: Record<string, unknown>): SharedForm => formsOf(parseConfig(raw)).shared
const abc = (fields: Record<string, unknown> = {}) => ({ id: 'id-abc', key: 'ABC', repo: 'C:\\abc', ...fields })
const xyz = (fields: Record<string, unknown> = {}) => ({ id: 'id-xyz', key: 'XYZ', repo: 'C:\\xyz', ...fields })

describe('formsOf', () => {
  it('fills a project in with what it inherits', () => {
    const raw = { tracker: 'github', brief: false, chain: { requiredLabels: ['Auto'] }, projects: [abc({ github: 'octo-org/abc', slot: true })] }
    expect(formOf(raw, 'ABC')).toMatchObject({
      repo: 'C:\\abc',
      branch: 'main',
      tracker: 'github',
      trackerProject: 'octo-org/abc',
      slot: 1,
      brief: false,
      chain: { active: null, terminal: null, requiredLabels: ['Auto'], excludedLabels: ['Manual', 'Вручную'] },
    })
    expect(formOf({ projects: [abc()] }, 'ABC')).toMatchObject({ name: null, tracker: 'huly', trackerProject: null, slot: 0, brief: true })
  })

  it('names the project key of each tracker', () => {
    expect(trackerChoices()).toEqual([
      { name: 'huly', projectKey: null },
      { name: 'github', projectKey: { key: 'github', example: 'octo-org/example', optional: false } },
      { name: 'linear', projectKey: { key: 'linear', example: 'Web app', optional: true } },
    ])
  })
})

describe('withProjectForm', () => {
  it('writes only what differs from what the project inherits, into the entry with the id', () => {
    const raw = { tracker: 'huly', projects: [abc(), xyz()], custom: 1 }
    const form: ProjectForm = {
      ...formOf(raw, 'ABC'),
      repo: ' D:\\abc ',
      branch: 'master',
      tracker: 'github',
      trackerProject: 'octo-org/abc',
      slot: 3,
      brief: false,
      chain: { active: ['Todo', ' '], terminal: [], requiredLabels: [], excludedLabels: ['Manual', 'Вручную'] },
    }
    const next = withProjectForm(raw, 'id-abc', form, formOf(raw, 'ABC'))
    expect(next).toEqual({
      tracker: 'huly',
      projects: [
        abc({ repo: 'D:\\abc', branch: 'master', slot: 3, tracker: 'github', brief: false, chain: { active: ['Todo'] }, github: 'octo-org/abc' }),
        xyz(),
      ],
      custom: 1,
    })
    expect(parseConfig(next).slots.ABC).toBe(3)
  })

  it('keeps keys the form leaves as they were, even when they repeat the shared value', () => {
    const entry = abc({ tracker: 'huly', slot: true, chain: { excludedLabels: ['Manual', 'Вручную'] } })
    const raw = { projects: [entry] }
    const form = { ...formOf(raw, 'ABC'), prompt: 'Hi.' }
    expect(withProjectForm(raw, 'id-abc', form, formOf(raw, 'ABC'))).toEqual({ projects: [{ ...entry, prompt: 'Hi.' }] })
  })

  it('removes the keys that go back to what is inherited, and the project key of the tracker left', () => {
    const raw = { brief: false, projects: [abc({ tracker: 'github', github: 'octo-org/abc', brief: true, slot: 2, chain: { requiredLabels: ['Auto'] } })] }
    const form: ProjectForm = { ...formOf(raw, 'ABC'), tracker: 'huly', trackerProject: null, brief: false, slot: 0, chain: { active: null, terminal: null, requiredLabels: [], excludedLabels: ['Manual', 'Вручную'] } }
    expect(withProjectForm(raw, 'id-abc', form, formOf(raw, 'ABC'))).toEqual({ brief: false, projects: [abc()] })
  })

  it('writes null for statuses by category over a shared list', () => {
    const raw = { chain: { terminal: ['Done'] }, projects: [abc()] }
    const form = { ...formOf(raw, 'ABC'), chain: { ...formOf(raw, 'ABC').chain, terminal: [] } }
    const next = withProjectForm(raw, 'id-abc', form, formOf(raw, 'ABC'))
    expect(next.projects).toEqual([abc({ chain: { terminal: null } })])
    expect(parseConfig(next).rules.ABC?.terminal).toBeNull()
  })

  it('leaves a hand edit of the file alone where the form kept the value it started from', () => {
    const base = formOf({ projects: [abc()] }, 'ABC')
    const entry = abc({ prompt: 'Hand.', slot: 2, branch: 'trunk', ci: { waitMinutes: 5 }, commands: { check: ['npm test'] } })
    const form: ProjectForm = { ...base, beforeStart: ['npm ci'], brief: false }
    expect(withProjectForm({ projects: [entry] }, 'id-abc', form, base)).toEqual({
      projects: [{ ...entry, commands: { check: ['npm test'], beforeStart: ['npm ci'] }, brief: false }],
    })
  })

  it('writes a field changed both in the form and in the file over the file', () => {
    const base = formOf({ projects: [abc()] }, 'ABC')
    const form: ProjectForm = { ...base, prompt: 'Mine.', slot: 4 }
    expect(withProjectForm({ projects: [abc({ prompt: 'Hand.', slot: 2 })] }, 'id-abc', form, base)).toEqual({ projects: [abc({ prompt: 'Mine.', slot: 4 })] })
  })

  it('writes the name of a project trimmed, and removes it when emptied', () => {
    const raw = { projects: [abc()] }
    const named = withProjectForm(raw, 'id-abc', { ...formOf(raw, 'ABC'), name: '  Web shop ' }, formOf(raw, 'ABC'))
    expect(named).toEqual({ projects: [abc({ name: 'Web shop' })] })
    expect(formOf(named, 'ABC').name).toBe('Web shop')
    expect(withProjectForm(named, 'id-abc', { ...formOf(named, 'ABC'), name: ' ' }, formOf(named, 'ABC'))).toEqual({ projects: [abc()] })
  })

  it('refuses a project the config does not know', () => {
    const raw = { projects: [abc()] }
    expect(() => withProjectForm(raw, 'id-xyz', formOf(raw, 'ABC'), formOf(raw, 'ABC'))).toThrow(/id-xyz/)
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
      chain: { active: null, terminal: null, requiredLabels: ['Auto'], excludedLabels: ['Manual', 'Вручную'] },
      stats: { ...sharedOf(raw).stats, compare: { minTasks: 5, minSessions: 10, days: 7 }, otherBelow: 2 },
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
    })
  })

  it('keeps shared keys the form leaves as they were', () => {
    const raw = { projects: [], models: { claude: 'opus' }, parallel: 1, promptLanguage: 'en' }
    expect(withSharedForm(raw, sharedOf(raw), sharedOf(raw))).toEqual(raw)
  })

  it('leaves a hand edit of the file alone and writes a field changed in both over it', () => {
    const base = sharedOf({ projects: [] })
    const edited = { projects: [], model: 'opus', parallel: 2, chain: { requiredLabels: ['Auto'] } }
    const form: SharedForm = { ...base, parallel: 3, chain: { ...base.chain, excludedLabels: [] } }
    expect(withSharedForm(edited, form, base)).toEqual({ projects: [], model: 'opus', parallel: 3, chain: { requiredLabels: ['Auto'], excludedLabels: [] } })
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

describe('withNewProject', () => {
  const draft: ProjectDraft = { repo: ' D:\\new ', branch: 'main', key: 'NEW', name: '', tracker: 'huly', trackerProject: '', profile: null, slot: 0 }

  it('appends an entry with only what differs from what the project would inherit', () => {
    const raw = { projects: [abc()], custom: 1 }
    const next = withNewProject(raw, draft, 'id-new')
    expect(next).toEqual({ projects: [abc(), { id: 'id-new', key: 'NEW', repo: 'D:\\new' }], custom: 1 })
    expect(parseConfig(next).projects).toEqual({ ABC: 'C:\\abc', NEW: 'D:\\new' })
  })

  it('writes the name, the branch, the tracker, its project and the slots when they are the project own', () => {
    const next = withNewProject({ projects: [] }, { ...draft, name: ' New ', branch: 'master', tracker: 'github', trackerProject: ' octo-org/new ', slot: 2 }, 'id-new')
    expect(next.projects).toEqual([{ id: 'id-new', key: 'NEW', repo: 'D:\\new', name: 'New', branch: 'master', tracker: 'github', github: 'octo-org/new', slot: 2 }])
    expect(withNewProject({ tracker: 'github', projects: [] }, { ...draft, tracker: 'github', trackerProject: 'octo-org/new' }, 'id-new').projects).toEqual([
      { id: 'id-new', key: 'NEW', repo: 'D:\\new', github: 'octo-org/new' },
    ])
  })

  it('starts the list of projects in a config that has none', () => {
    expect(withNewProject({}, draft, 'id-new')).toEqual({ projects: [{ id: 'id-new', key: 'NEW', repo: 'D:\\new' }] })
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
