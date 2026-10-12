import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import type { ConfigView, EvenKeelState, ProjectForm, SharedForm } from '../../../src/state.js'

const CI_ALL = { kinds: ['forgejo', 'github'], waitMinutes: null, recheckMain: true, fixTask: false } as ProjectForm['ci']

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
  allowedHosts: [],
  context: { window: 600_000, warn: 50, danger: 80 },
  stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null },
}

const project = (repo: string, change: Partial<ProjectForm>): ProjectForm => ({
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
      ABC: project('D:/Projects/abc', { brief: false, prompt: 'Run npm test before merging.', beforeStart: ['npm ci'], fillMilestone: true }),
      DEMO: project('D:/Projects/demo', {
        branch: 'master',
        tracker: 'github',
        trackerProject: 'octo-org/demo',
        ci: { kinds: ['github'], waitMinutes: 15, recheckMain: true, fixTask: true },
      }),
      XYZ: project('D:/Projects/xyz', { slot: 2, chain: { ...DEFAULT_RULES, requiredLabels: ['Auto'] } }),
      OPS: project('D:/Projects/ops', { beforeStart: ['npm ci'], check: ['npm run typecheck', 'npm test'], ci: { kinds: [], waitMinutes: 0, recheckMain: false, fixTask: false } }),
    },
    restart: [],
    trackers: [
      { name: 'huly', projectKey: null },
      { name: 'github', projectKey: { key: 'github', example: 'octo-org/example', optional: false } },
      { name: 'linear', projectKey: { key: 'linear', example: 'Web app', optional: true } },
    ],
  }
}

/** `?config=restart` — saved values that wait for a restart of the service. */
export const fakeRestart = (config: ConfigView): ConfigView => ({ ...config, restart: ['tracker', 'context', 'ABC.repo', 'XYZ.slot'] })

/** What the service would save: the form as it came, lines trimmed. */
export function fakeSettingsCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  const lines = (list: unknown) => (list as string[]).map((line) => line.trim()).filter((line) => line !== '')
  if (name === 'settings') return { ...state, config: { ...state.config, shared: body as unknown as SharedForm } }
  if (name !== 'project/settings') return null
  const { project: key, ...form } = body as unknown as ProjectForm & { project: string }
  const prompt = form.prompt?.trim() ?? ''
  const saved: ProjectForm = { ...form, prompt: prompt === '' ? null : prompt, beforeStart: lines(form.beforeStart), check: lines(form.check) }
  return { ...state, config: { ...state.config, projects: { ...state.config.projects, [key]: saved } } }
}
