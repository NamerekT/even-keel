import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serverFixture, STANDARD } from '../test/server.fixture.js'
import { projectFormDefaults, sharedFormDefaults } from './settings/expectations.fixture.js'

describe('Even Keel settings HTTP routes', () => {
  let publicDir: string
  let calls: unknown[][]
  let base: string
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ publicDir, calls, base, close } = await serverFixture())
  })

  afterEach(async () => {
    await close()
    rmSync(publicDir, { recursive: true, force: true })
  })

  // These read-only fields have dedicated routes and are not forwarded by project/settings.
  const { protection, notices, milestoneOrder, badge, ...defaults } = projectFormDefaults()
  const chain = { ...defaults.chain, terminal: ['Done'], excludedLabels: ['Manual'] }
  const form = { ...defaults, name: 'Web shop', branch: 'master', tracker: 'github', trackerProject: 'octo-org/abc', slot: 2, color: 3, brief: false, chain, provider: 'codex', models: { codex: 'gpt-6.1-sol' }, modelLabels: true, remoteProfiles: { forgejo: 'own' } }

  it('passes the settings of a project on with the values the form started from', async () => {
    const ci = { guard: false, kinds: ['github'], waitMinutes: 15, recheckMain: false, fixTask: true, rerunFailed: false }
    const settings = {
      ...{ prompt: 'Run npm test.', beforeStart: ['npm ci'], check: ['npm test'], afterGreen: ['npm run build'], ci, fillMilestone: true, changelog: 'docs/CHANGELOG.md', standards: [STANDARD], ...form },
      ...{ testProject: true, promptLanguage: 'ru', cacheTtl: '1h', autoCompactWindow: 400_000, codexAutoCompactWindow: 250_000, openCodeAutoCompactWindow: 180_000, contextHandoffs: false, checkpointTokens: 180_000, checkpointShares: { first: 60, late: 85, hard: 95 } },
      own: { 'ci.guard': false, cacheTtl: '1h', autoCompactWindow: 400_000, codexAutoCompactWindow: 250_000, openCodeAutoCompactWindow: 180_000, contextHandoffs: false, 'stats.checkpointShares.first': 60 },
      ownRules: [],
    }
    const started = { ...settings, prompt: null, slot: 0, own: {} }
    const response = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify({ project: 'ABC', ...settings, base: started }) })
    expect(response.status).toBe(200)
    expect(calls).toContainEqual(['settings', 'ABC', settings, started])

    const unknown = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify({ project: 'ABC', ...settings, own: { parallel: 2 }, base: started }) })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'own' } })

    const missing = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify({ project: 'ABC', ...settings }) })
    expect(missing.status).toBe(400)
    expect((await missing.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'base' } })
  })

  it('checks and adds the wizard project, removes a project, and refuses a draft of a wrong shape', async () => {
    const draft = { repo: 'D:\\new', branch: '', key: 'NEW', name: '', tracker: 'huly', trackerProject: '', profile: null, slot: 0 }
    const check = await fetch(base + '/api/project/check', { method: 'POST', body: JSON.stringify(draft) })
    expect(check.status).toBe(200)
    expect(await check.json()).toEqual({ repo: { root: 'D:\\new', current: 'main', notice: null }, entry: null, tracker: null, trusted: true, platform: 'win32' })

    // The page holds the tracker's answer: the tracker is not asked (BTN-737).
    expect((await fetch(base + '/api/project/check', { method: 'POST', body: JSON.stringify({ ...draft, askTracker: false }) })).status).toBe(200)
    expect((await fetch(base + '/api/project/add', { method: 'POST', body: JSON.stringify(draft) })).status).toBe(200)
    expect((await fetch(base + '/api/project/remove', { method: 'POST', body: JSON.stringify({ project: 'ABC' }) })).status).toBe(200)
    // A page open since before the milestones and the agent fields sends neither.
    expect(calls).toEqual([
      ['check', { ...draft, milestones: [], provider: null }, { tracker: true }],
      ['check', { ...draft, milestones: [], provider: null }, { tracker: false }],
      ['add', { ...draft, milestones: [], provider: null }],
      ['removeProject', 'ABC'],
    ])

    for (const [field, change] of [['slot', { slot: -1 }], ['key', { key: 5 }], ['branch', { branch: undefined }], ['milestones', { milestones: ['v1', 2] }]] as const) {
      const response = await fetch(base + '/api/project/check', { method: 'POST', body: JSON.stringify({ ...draft, ...change }) })
      expect(response.status).toBe(400)
      expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field } })
    }
  })

  it('refuses project settings of a wrong shape', async () => {
    const ci = { guard: true, kinds: [], waitMinutes: null, recheckMain: true, fixTask: false }
    const bad = [
      ['branch', { branch: 1 }],
      ['slot', { slot: -1 }],
      ['slot', { slot: true }],
      ['color', { color: 'red' }],
      ['trackerProject', { trackerProject: 5 }],
      ['name', { name: 5 }],
      ['brief', { brief: 'no' }],
      ['provider', { provider: 5 }],
      ['models', { models: { codex: 5 } }],
      ['accounts', { accounts: null }],
      ['modelLabels', { modelLabels: 'yes' }],
      ['chain', { chain: { ...chain, active: 'Todo' } }],
    ] as const
    for (const [field, change] of bad) {
      const body = { project: 'ABC', prompt: '', beforeStart: [], check: [], afterGreen: [], ci, fillMilestone: false, changelog: 'CHANGELOG.md', ...form, ...change }
      const response = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify(body) })
      expect(response.status).toBe(400)
      expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field } })
    }
  })

  it('passes the shared settings on and refuses a wrong shape', async () => {
    const shared = {
      ...sharedFormDefaults(),
      parallel: 2,
      brief: true,
      chain,
      provider: 'claude',
      models: { claude: 'opus' },
      execution: { codex: 'sandbox' },
      cli: { claude: 'checked', codex: 'system' },
      modelPrompts: { haiku: 'Be brief.' },
      prompt: '# Rules\n\n- Answer in English.',
      hiddenSkills: ['dataviz'],
      cacheTtl: '1h',
      autoCompactWindow: 300_000,
      codexAutoCompactWindow: 250_000,
      openCodeAutoCompactWindow: 200_000,
      contextHandoffs: false,
      keepWarm: 2,
      defaultGit: false,
      setupPassed: ['tracker'],
      cliCheck: true,
      stats: { ...sharedFormDefaults().stats, checkpointShares: { ...sharedFormDefaults().stats.checkpointShares, first: 70 } },
      updates: { check: true, notify: false },
      ci: { guard: true, kinds: ['github'], waitMinutes: 15, recheckMain: false, fixTask: true, rerunFailed: false },
      fillMilestone: true,
    }
    // Notices are written through their own route.
    delete shared.notices
    const started = { ...shared, parallel: 1 }
    const response = await fetch(base + '/api/settings', { method: 'POST', body: JSON.stringify({ ...shared, base: started }) })
    expect(response.status).toBe(200)
    expect(calls).toContainEqual(['shared', shared, started])

    const refusals = [
      ['parallel', { parallel: '2' }],
      ['keepWarm', { keepWarm: '2' }],
      ['cliCheck', { cliCheck: 'on' }],
      ['defaultGit', { defaultGit: 'no' }],
      ['setupPassed', { setupPassed: ['agent'] }],
      ['contextHandoffs', { contextHandoffs: 'off' }],
      ['modelPrompts', { modelPrompts: { haiku: 1 } }],
      ['prompt', { prompt: 1 }],
      ['execution', { execution: { codex: true } }],
      ['cli', { cli: 'checked' }],
      ['modelLabels', { modelLabels: null }],
      ['stats', { stats: { ...shared.stats, moves: [] } }],
      ['stats', { stats: { ...shared.stats, checkpointShares: { first: '70', late: 85, hard: 95 } } }],
      ['updates', { updates: { check: 'yes', notify: true } }],
    ] as const
    for (const [field, change] of refusals) {
      const refused = await fetch(base + '/api/settings', { method: 'POST', body: JSON.stringify({ ...shared, ...change }) })
      expect(refused.status).toBe(400)
      expect((await refused.json()).notice).toMatchObject({ code: 'request.required', params: { field } })
    }
  })

})
