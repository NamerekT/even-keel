import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import type { ConfigView, EvenKeelState, ProjectForm, SharedForm } from '../../../src/state.js'
import type { TrackerVocabulary } from '../../../src/tracker/source.js'
import { GITHUB_PROFILE } from './fakeProfiles.js'

export const FAKE_PROJECT_IDS: Record<string, string> = {
  ABC: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e01',
  DEMO: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e02',
  XYZ: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e03',
  OPS: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e04',
}

/** ABC and XYZ are clones of one repository, so Home shows them as a group; OPS has no remote. */
export const FAKE_REMOTES: EvenKeelState['remotes'] = {
  ABC: [{ id: 'git.example.com/john/app', path: 'john/app' }],
  DEMO: [{ id: 'git.example.com/john/demo', path: 'john/demo' }],
  XYZ: [
    { id: 'git.example.com/john/app', path: 'john/app' },
    { id: 'github.com/octo-org/app', path: 'octo-org/app' },
  ],
  OPS: [],
}

/** What the fake tracker names for every project: some of it no fake task carries (`?vocabulary=none|fail`). */
export const FAKE_VOCABULARY: TrackerVocabulary = {
  statuses: ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Blocked'],
  labels: ['Bug', 'Feature', 'Docs', 'Manual', 'Question', 'Research', 'UI'],
}

const CI_ALL: ProjectForm['ci'] = { guard: true, kinds: ['forgejo', 'github'], waitMinutes: null, recheckMain: true, fixTask: false }

export const FAKE_SHARED: SharedForm = {
  parallel: 1,
  tracker: 'huly',
  brief: null,
  chain: DEFAULT_RULES,
  provider: 'claude',
  models: { claude: 'opus' },
  accounts: { claude: 'global', codex: 'codex' },
  execution: { codex: 'sandbox' },
  cli: { claude: 'checked', codex: 'checked' },
  modelLabels: false,
  modelPrompts: {},
  language: null,
  promptLanguage: 'en',
  hiddenSkills: ['update-config', 'keybindings-help', 'loop', 'schedule', 'init'],
  cacheTtl: null,
  allowedHosts: [],
  context: { window: 600_000, warn: 50, danger: 80 },
  stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null },
  updates: { check: true, notify: true },
  ci: CI_ALL,
  fillMilestone: false,
}

const project = (repo: string, change: Partial<ProjectForm>): ProjectForm => ({
  name: null,
  repo,
  branch: 'main',
  tracker: 'huly',
  trackerProject: null,
  slot: 0,
  color: null,
  brief: null,
  chain: DEFAULT_RULES,
  prompt: null,
  beforeStart: [],
  check: [],
  afterGreen: [],
  ci: CI_ALL,
  remoteProfiles: {},
  pullRequests: false,
  fillMilestone: false,
  changelog: 'CHANGELOG.md',
  provider: null,
  models: {},
  accounts: {},
  modelLabels: null,
  promptLanguage: 'en',
  cacheTtl: null,
  checkpointTokens: null,
  own: {},
  ...change,
})

export function fakeConfig(): ConfigView {
  return {
    shared: { ...FAKE_SHARED, brief: false, modelPrompts: { haiku: 'Keep answers short.' } },
    projects: {
      ABC: project('D:/Projects/abc', { color: 1, name: 'Storefront', brief: false, prompt: 'Run npm test before merging.', beforeStart: ['npm ci'], fillMilestone: true, own: { fillMilestone: true } }),
      DEMO: project('D:/Projects/demo', {
        color: 2,
        branch: 'master',
        tracker: 'github',
        trackerProject: 'octo-org/demo',
        afterGreen: ['npm run build', 'pwsh -File service/restart.ps1'],
        ci: { guard: true, kinds: ['github'], waitMinutes: 15, recheckMain: true, fixTask: true },
        promptLanguage: 'ru',
        checkpointTokens: 180_000,
        own: { 'ci.kinds': ['github'], 'ci.waitMinutes': 15, 'ci.fixTask': true, promptLanguage: 'ru', 'stats.checkpointTokens': 180_000 },
      }),
      XYZ: project('D:/Projects/xyz', { color: 3, slot: 2, chain: { ...DEFAULT_RULES, requiredLabels: ['Auto'] }, provider: 'codex', models: { codex: 'gpt-6.1-sol' }, modelLabels: true, remoteProfiles: { github: GITHUB_PROFILE } }),
      OPS: project('D:/Projects/ops', { color: 4, beforeStart: ['npm ci'], check: ['npm run typecheck', 'npm test'], ci: { guard: false, kinds: [], waitMinutes: 0, recheckMain: false, fixTask: false },
        own: { 'ci.guard': false, 'ci.kinds': [], 'ci.waitMinutes': 0, 'ci.recheckMain': false },
      }),
    },
    trackers: [
      { name: 'huly', title: 'Huly', projectKey: null },
      { name: 'github', title: 'GitHub', projectKey: { key: 'github', example: 'octo-org/example', optional: false } },
      { name: 'linear', title: 'Linear', projectKey: { key: 'linear', example: 'Web app', optional: true } },
    ],
    trackerLocked: ['ABC', 'DEMO'],
  }
}

/** `?config=edited`, a few seconds after the page opens — the file edited by hand under the forms: ABC's prompt and branch, the shared model. */
export const fakeHandEdit = (config: ConfigView): ConfigView => {
  const abc = config.projects.ABC!
  return {
    ...config,
    shared: { ...config.shared, models: { ...config.shared.models, claude: 'sonnet' } },
    projects: { ...config.projects, ABC: { ...abc, branch: 'trunk', prompt: 'Run npm test and npm run lint before merging.' } },
  }
}

/** What the service would save: the form as it came, lines trimmed. */
export function fakeSettingsCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  const lines = (list: unknown) => (list as string[]).map((line) => line.trim()).filter((line) => line !== '')
  const { base: _base, ...sent } = body
  if (name === 'settings') return { ...state, config: { ...state.config, shared: sent as unknown as SharedForm } }
  if (name !== 'project/settings') return null
  const { project: key, ...form } = sent as unknown as ProjectForm & { project: string }
  const prompt = form.prompt?.trim() ?? ''
  const title = form.name?.trim() ?? ''
  const saved: ProjectForm = {
    ...form,
    name: title === '' ? null : title,
    prompt: prompt === '' ? null : prompt,
    beforeStart: lines(form.beforeStart),
    check: lines(form.check),
    afterGreen: lines(form.afterGreen),
  }
  return { ...state, config: { ...state.config, projects: { ...state.config.projects, [key]: saved } } }
}
