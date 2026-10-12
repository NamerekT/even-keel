import { describe, expect, it } from 'vitest'
import { formsOf, restartPending, trackerChoices, withProjectForm, withSharedForm } from './config-form.js'
import { parseConfig } from './config.js'
import type { ProjectForm, SharedForm } from './state.js'

const formOf = (raw: Record<string, unknown>, project: string): ProjectForm => formsOf(parseConfig(raw)).projects[project]!
const sharedOf = (raw: Record<string, unknown>): SharedForm => formsOf(parseConfig(raw)).shared

describe('formsOf', () => {
  it('fills a project in with what it inherits', () => {
    const raw = { tracker: 'github', brief: false, chain: { requiredLabels: ['Auto'] }, projects: { ABC: { repo: 'C:\\abc', github: 'octo-org/abc', slot: true } } }
    expect(formOf(raw, 'ABC')).toMatchObject({
      repo: 'C:\\abc',
      branch: 'main',
      tracker: 'github',
      trackerProject: 'octo-org/abc',
      slot: 1,
      brief: false,
      chain: { active: null, terminal: null, requiredLabels: ['Auto'], excludedLabels: ['Manual', 'Вручную'] },
    })
    expect(formOf({ projects: { ABC: 'C:\\abc' } }, 'ABC')).toMatchObject({ tracker: 'huly', trackerProject: null, slot: 0, brief: true })
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
  it('writes only what differs from what the project inherits', () => {
    const raw = { tracker: 'huly', projects: { ABC: 'C:\\abc', XYZ: 'C:\\xyz' }, custom: 1 }
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
    const next = withProjectForm(raw, 'ABC', form)
    expect(next).toEqual({
      tracker: 'huly',
      projects: { ABC: { repo: 'D:\\abc', branch: 'master', slot: 3, tracker: 'github', brief: false, chain: { active: ['Todo'] }, github: 'octo-org/abc' }, XYZ: 'C:\\xyz' },
      custom: 1,
    })
    expect(parseConfig(next).slots.ABC).toBe(3)
  })

  it('keeps keys the form leaves as they were, even when they repeat the shared value', () => {
    const raw = { projects: { ABC: { repo: 'C:\\abc', tracker: 'huly', slot: true, chain: { excludedLabels: ['Manual', 'Вручную'] } } } }
    const form = { ...formOf(raw, 'ABC'), prompt: 'Hi.' }
    expect(withProjectForm(raw, 'ABC', form)).toEqual({ projects: { ABC: { ...raw.projects.ABC, prompt: 'Hi.' } } })
  })

  it('removes the keys that go back to what is inherited, and the project key of the tracker left', () => {
    const raw = { brief: false, projects: { ABC: { repo: 'C:\\abc', tracker: 'github', github: 'octo-org/abc', brief: true, slot: 2, chain: { requiredLabels: ['Auto'] } } } }
    const form: ProjectForm = { ...formOf(raw, 'ABC'), tracker: 'huly', trackerProject: null, brief: false, slot: 0, chain: { active: null, terminal: null, requiredLabels: [], excludedLabels: ['Manual', 'Вручную'] } }
    expect(withProjectForm(raw, 'ABC', form)).toEqual({ brief: false, projects: { ABC: { repo: 'C:\\abc' } } })
  })

  it('writes null for statuses by category over a shared list', () => {
    const raw = { chain: { terminal: ['Done'] }, projects: { ABC: 'C:\\abc' } }
    const form = { ...formOf(raw, 'ABC'), chain: { ...formOf(raw, 'ABC').chain, terminal: [] } }
    const next = withProjectForm(raw, 'ABC', form)
    expect(next.projects).toEqual({ ABC: { repo: 'C:\\abc', chain: { terminal: null } } })
    expect(parseConfig(next).rules.ABC?.terminal).toBeNull()
  })

  it('refuses a project the config does not know', () => {
    const raw = { projects: { ABC: 'C:\\abc' } }
    expect(() => withProjectForm(raw, 'XYZ', formOf(raw, 'ABC'))).toThrow(/XYZ/)
  })
})

describe('withSharedForm', () => {
  it('writes what differs from the defaults and removes what goes back to them', () => {
    const raw = { projects: { ABC: 'C:\\abc' }, model: 'sonnet', hiddenSkills: ['a'], custom: true, stats: { compare: { days: 14 }, extra: 1 } }
    const form: SharedForm = {
      ...sharedOf(raw),
      parallel: 2,
      model: 'opus',
      hiddenSkills: formsOf(parseConfig({ projects: {} })).shared.hiddenSkills,
      language: 'ru',
      promptLanguage: 'ru',
      allowedHosts: [' Box.Example.com '],
      context: { window: 1_000_000, warn: 50, danger: 80 },
      modelPrompts: { haiku: ' Be brief. ', sonnet: ' ' },
      chain: { active: null, terminal: null, requiredLabels: ['Auto'], excludedLabels: ['Manual', 'Вручную'] },
      stats: { ...sharedOf(raw).stats, compare: { minTasks: 5, minSessions: 10, days: 7 }, otherBelow: 2 },
    }
    expect(withSharedForm(raw, form)).toEqual({
      projects: { ABC: 'C:\\abc' },
      custom: true,
      parallel: 2,
      language: 'ru',
      allowedHosts: ['box.example.com'],
      context: { window: 1_000_000 },
      modelPrompts: { haiku: 'Be brief.' },
      chain: { requiredLabels: ['Auto'] },
      stats: { extra: 1, otherBelow: 2 },
    })
  })

  it('keeps shared keys the form leaves as they were', () => {
    const raw = { projects: {}, model: 'opus', parallel: 1, promptLanguage: 'en' }
    expect(withSharedForm(raw, sharedOf(raw))).toEqual(raw)
  })
})

describe('restartPending', () => {
  it('names what is saved but waits for a restart', () => {
    const current = parseConfig({ projects: { ABC: 'C:\\abc', XYZ: 'C:\\xyz' } })
    const saved = parseConfig({
      tracker: 'linear',
      context: { window: 1_000_000 },
      projects: { ABC: { repo: 'D:\\abc', slot: 2 }, XYZ: { repo: 'C:\\xyz', tracker: 'github', github: 'o/x' }, NEW: 'C:\\new' },
    })
    expect(restartPending(current, saved)).toEqual(['tracker', 'context', 'ABC.repo', 'ABC.slot', 'ABC.tracker', 'XYZ.tracker', 'XYZ.trackerProject', 'NEW'])
    expect(restartPending(current, current)).toEqual([])
  })
})
