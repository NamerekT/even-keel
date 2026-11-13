import type { EvenKeelConfig } from '../config.js'
import type { ProjectForm, ProjectSettings, SharedForm } from '../state.js'

// Deliberately independent of the parser and registry: a wrong default must still fail their tests.
const common = {
  prompt: null,
  promptLanguage: 'en' as const,
  cacheTtl: null,
  autoCompactWindow: null,
  codexAutoCompactWindow: null,
  openCodeAutoCompactWindow: null,
  contextHandoffs: true,
  protection: { disabled: [], claude: [], codex: [], copilot: [], opencode: [] },
  ci: { guard: true, kinds: ['forgejo', 'github', 'gitlab'], waitMinutes: null, recheckMain: true, fixTask: false, rerunFailed: true },
  fillMilestone: false,
  notices: {},
} satisfies Partial<ProjectSettings>

const shares = { first: 72, late: 85, hard: 95 }
const checkpoint = { checkpointTokens: null, checkpointShares: shares }
const chain = { active: null, terminal: null, requiredLabels: [], excludedLabels: [], requiredMilestones: [], excludedMilestones: [] }
const project: ProjectSettings = {
  ...common,
  branch: 'main',
  beforeStart: [],
  check: [],
  afterGreen: [],
  remoteProfiles: {},
  pullRequests: false,
  testProject: false,
  intakeLabel: null,
  mergeInto: null,
  carryAgent: false,
  git: true,
  milestoneOrder: [],
  badge: null,
  changelog: 'CHANGELOG.md',
  standards: [],
  provider: null,
  models: {},
  accounts: {},
  ...checkpoint,
  own: {},
}

export const projectDefaults = (overrides: Partial<ProjectSettings> = {}): ProjectSettings => ({ ...structuredClone(project), ...overrides })

export function configDefaults(projects: Record<string, string> = {}): EvenKeelConfig {
  const each = <T>(value: (id: string, index: number) => T): Record<string, T> => Object.fromEntries(Object.keys(projects).map((id, index) => [id, structuredClone(value(id, index))]))
  return structuredClone({
    ...common,
    allowedHosts: [],
    projects,
    keys: each((id) => id),
    names: {},
    rules: each(() => chain),
    ownRules: each(() => ({})),
    slots: {},
    colors: each((_, index) => index + 1),
    chain,
    trackers: each(() => 'github'),
    trackerProjects: {},
    feeds: {},
    moves: {},
    brief: null,
    briefs: each(() => null),
    settings: each(() => projectDefaults()),
    context: { window: 600_000, warn: 50, danger: 80 },
    provider: 'claude',
    models: { claude: 'opus' },
    accounts: { claude: 'global', codex: 'codex' },
    execution: { claude: 'auto', codex: 'sandbox' },
    cli: { claude: 'system', codex: 'system', opencode: 'system', copilot: 'system' },
    modelPrompts: {},
    stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, ...checkpoint },
    language: null,
    hiddenSkills: ['update-config', 'keybindings-help', 'fewer-permission-prompts', 'loop', 'schedule', 'init', 'claude-api', 'claude-in-chrome', 'plugin-authoring', 'artifact-design', 'artifact-diagramming', 'artifact-capabilities', 'dataviz'],
    parallel: 1,
    keepWarm: 0,
    attachmentLimit: 25,
    defaultGit: null,
    setupPassed: [],
    cliCheck: false,
    updates: { check: true, notify: true },
    unattended: false,
    trimTools: true,
    tally: null,
  })
}

export const projectFormDefaults = (overrides: Partial<ProjectForm> = {}): ProjectForm => ({
  ...projectDefaults(), name: null, repo: 'C:\\abc', tracker: 'huly', trackerProject: null, slot: 0, color: 1,
  brief: null, chain: structuredClone(chain), ownRules: [], ...overrides,
})

export function sharedFormDefaults(): SharedForm {
  const { projects, keys, names, rules, ownRules, slots, colors, trackers, trackerProjects, feeds, moves, briefs, settings, unattended, trimTools, tally, ...shared } = configDefaults()
  return shared
}
