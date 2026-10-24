import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import { notice } from '../../../src/notice/notice.js'
import type { ConfigView, EvenKeelState, ProjectForm, SharedForm } from '../../../src/state.js'
import { DEFAULT_SHARES } from '../../../src/stats/checkpoint.js'
import type { TrackerVocabulary } from '../../../src/tracker/source.js'
import { GITHUB_PROFILE } from './fakeProfiles.js'

/** The fake projects; the id of each is its key, so the fakes need no map between them. */
export const FAKE_PROJECTS = ['ABC', 'DEMO', 'XYZ', 'OPS']

/** The state's maps by the key of each project (`keys`): a key two projects share is shown with the name, as the service does. */
export function fakeProjectMaps(
  keys: Record<string, string> = Object.fromEntries(FAKE_PROJECTS.map((project) => [project, project])),
  names: Record<string, string | null> = {},
): Pick<EvenKeelState, 'projectKeys' | 'projectLabels' | 'taskPrefixes'> {
  const shared = (project: string) => Object.keys(keys).some((other) => other !== project && keys[other] === keys[project])
  const labels = Object.fromEntries(Object.entries(keys).map(([project, key]) => [project, shared(project) ? `${key} (${names[project] ?? project})` : key]))
  return { projectKeys: keys, projectLabels: labels, taskPrefixes: keys }
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

/** No profile has a token for DEMO's Forgejo remote, so it offers "Add profile"; OPS has no remote to open pull requests on. */
export const FAKE_PULL_READINESS: EvenKeelState['pullReadiness'] = {
  ABC: null,
  DEMO: notice('review.noToken', { remote: 'origin', kind: 'forgejo', web: 'https://git.example.com' }),
  XYZ: null,
  OPS: notice('review.noRemote', { project: 'OPS' }),
}

/** What the fake tracker names for every project: some of it no fake task carries (`?vocabulary=none|fail`). */
export const FAKE_VOCABULARY: TrackerVocabulary = {
  statuses: [
    { name: 'Backlog', category: 'UnStarted' },
    { name: 'Todo', category: 'ToDo' },
    { name: 'In Progress', category: 'Active' },
    { name: 'In Review', category: 'Active' },
    { name: 'Done', category: 'Won' },
    { name: 'Canceled', category: 'Lost' },
    { name: 'Blocked', category: 'Active' },
  ],
  labels: ['Bug', 'Feature', 'Docs', 'Manual', 'Question', 'Research', 'UI'],
  milestones: ['v1.0', 'v1.1', 'v2.0'],
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
  cli: { claude: 'checked', codex: 'checked', opencode: 'checked', copilot: 'checked' },
  modelLabels: false,
  modelPrompts: {},
  prompt: null,
  language: null,
  promptLanguage: 'en',
  hiddenSkills: ['update-config', 'keybindings-help', 'loop', 'schedule', 'init'],
  cacheTtl: null,
  allowedHosts: [],
  context: { window: 600_000, warn: 50, danger: 80 },
  stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null, checkpointShares: DEFAULT_SHARES },
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
  ownRules: [],
  prompt: null,
  beforeStart: [],
  check: [],
  afterGreen: [],
  ci: CI_ALL,
  remoteProfiles: {},
  pullRequests: false,
  intakeLabel: null,
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
  checkpointShares: DEFAULT_SHARES,
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
      XYZ: project('D:/Projects/xyz', {
        ...{ color: 3, slot: 2, chain: { ...DEFAULT_RULES, requiredLabels: ['Auto'] }, ownRules: ['requiredLabels'], provider: 'codex', models: { codex: 'gpt-6.1-sol' }, modelLabels: true, remoteProfiles: { github: GITHUB_PROFILE } },
        checkpointShares: { first: 65, late: 80, hard: 90 },
        own: { 'stats.checkpointShares.first': 65, 'stats.checkpointShares.late': 80, 'stats.checkpointShares.hard': 90 },
      }),
      OPS: project('D:/Projects/ops', { color: 4, beforeStart: ['npm ci'], check: ['npm run typecheck', 'npm test'], ci: { guard: false, kinds: [], waitMinutes: 0, recheckMain: false, fixTask: false },
        own: { 'ci.guard': false, 'ci.kinds': [], 'ci.waitMinutes': 0, 'ci.recheckMain': false },
      }),
    },
    trackers: [
      { name: 'huly', title: 'Huly', projectKey: { key: 'huly', example: 'ABC', optional: true, alias: true } },
      { name: 'github', title: 'GitHub', projectKey: { key: 'github', example: 'octo-org/example', optional: false, alias: false } },
      { name: 'linear', title: 'Linear', projectKey: { key: 'linear', example: 'Web app', optional: true, alias: false } },
    ],
    feeds: {
      ABC: [
        { id: 'feed-abc-gh', tracker: 'github', key: 'ABCGH', place: 'octo-org/storefront-ideas' },
        { id: 'feed-abc-lin', tracker: 'linear', key: 'WEB', place: 'Web app' },
      ],
    },
    trackerLocked: ['ABC', 'DEMO', 'feed-abc-gh'],
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
