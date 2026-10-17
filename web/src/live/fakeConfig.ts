import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import type { ConfigView, EvenKeelState, ProjectForm, SharedForm } from '../../../src/state.js'

export const FAKE_PROJECT_IDS: Record<string, string> = {
  ABC: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e01',
  DEMO: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e02',
  XYZ: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e03',
  OPS: '6f1c2a4e-1b3d-4c5e-8f70-9a1b2c3d4e04',
}

const CI_ALL: ProjectForm['ci'] = { guard: true, kinds: ['forgejo', 'github'], waitMinutes: null, recheckMain: true, fixTask: false }

export const FAKE_SHARED: SharedForm = {
  parallel: 1,
  tracker: 'huly',
  brief: true,
  chain: DEFAULT_RULES,
  model: 'opus',
  modelPrompts: {},
  language: null,
  promptLanguage: 'en',
  hiddenSkills: ['update-config', 'keybindings-help', 'loop', 'schedule', 'init'],
  cacheTtl: null,
  allowedHosts: [],
  context: { window: 600_000, warn: 50, danger: 80 },
  stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null },
  updates: { check: true, notify: true },
}

const project = (repo: string, change: Partial<ProjectForm>): ProjectForm => ({
  name: null,
  repo,
  branch: 'main',
  tracker: 'huly',
  trackerProject: null,
  slot: 0,
  brief: true,
  chain: DEFAULT_RULES,
  prompt: null,
  beforeStart: [],
  check: [],
  ci: CI_ALL,
  fillMilestone: false,
  ...change,
})

export function fakeConfig(): ConfigView {
  return {
    shared: { ...FAKE_SHARED, brief: false, modelPrompts: { haiku: 'Keep answers short.' } },
    projects: {
      ABC: project('D:/Projects/abc', { name: 'Storefront', brief: false, prompt: 'Run npm test before merging.', beforeStart: ['npm ci'], fillMilestone: true }),
      DEMO: project('D:/Projects/demo', {
        branch: 'master',
        tracker: 'github',
        trackerProject: 'octo-org/demo',
        ci: { guard: true, kinds: ['github'], waitMinutes: 15, recheckMain: true, fixTask: true },
      }),
      XYZ: project('D:/Projects/xyz', { slot: 2, chain: { ...DEFAULT_RULES, requiredLabels: ['Auto'] } }),
      OPS: project('D:/Projects/ops', { beforeStart: ['npm ci'], check: ['npm run typecheck', 'npm test'], ci: { guard: false, kinds: [], waitMinutes: 0, recheckMain: false, fixTask: false } }),
    },
    restart: [],
    trackers: [
      { name: 'huly', projectKey: null },
      { name: 'github', projectKey: { key: 'github', example: 'octo-org/example', optional: false } },
      { name: 'linear', projectKey: { key: 'linear', example: 'Web app', optional: true } },
    ],
    trackerLocked: ['ABC', 'DEMO'],
  }
}

/** `?config=restart` — saved values that wait for a restart of the service. */
export const fakeRestart = (config: ConfigView): ConfigView => ({ ...config, restart: ['tracker', 'context', 'ABC.repo', 'XYZ.slot'] })

/** `?config=edited`, a few seconds after the page opens — the file edited by hand under the forms: ABC's prompt and branch, the shared model. */
export const fakeHandEdit = (config: ConfigView): ConfigView => {
  const abc = config.projects.ABC!
  return {
    ...config,
    shared: { ...config.shared, model: 'sonnet' },
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
  const saved: ProjectForm = { ...form, name: title === '' ? null : title, prompt: prompt === '' ? null : prompt, beforeStart: lines(form.beforeStart), check: lines(form.check) }
  return { ...state, config: { ...state.config, projects: { ...state.config.projects, [key]: saved } } }
}
