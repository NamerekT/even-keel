import { describe, expect, it } from 'vitest'
import { DEFAULT_CI, withProjectSettings } from './config.js'
import type { CiKind } from './ci/model.js'
import type { ProjectSettings } from './state.js'
import { DEFAULT_SHARES as SHARES } from './stats/checkpoint.js'

describe('withProjectSettings', () => {
  const base: ProjectSettings = {
    ...{ branch: 'main', prompt: null, beforeStart: [], check: [], afterGreen: [], ci: DEFAULT_CI, remoteProfiles: {}, pullRequests: false, fillMilestone: false },
    ...{ changelog: 'CHANGELOG.md', standards: [], provider: null, models: {}, accounts: {}, modelLabels: null, promptLanguage: 'en', cacheTtl: null, autoCompactWindow: null, checkpointTokens: null, checkpointShares: SHARES, own: {} },
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
