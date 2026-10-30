import { CLI_SOURCES, EXECUTION_MODES, DEFAULT_PROVIDER, isProvider, PINNED_PROVIDERS, PROVIDERS } from '../agent/providers.js'
import { DEFAULT_RULES, type ChainRules } from '../chain/rules.js'
import { changelogPath, DEFAULT_CHANGELOG } from '../changelog/file.js'
import { CI_KINDS, type CiKind, type RemoteProfiles } from '../ci/model.js'
import type { EvenKeelConfig } from '../config.js'
import { isLanguage, LANGUAGES } from '../language.js'
import { fail } from '../notice/notice.js'
import { isColor } from '../projects/colors.js'
import { standardsOf } from '../projects/standards.js'
import { MAX_KEEP_WARM_HOURS } from '../sessions/keepwarm.js'
import { promptPatternOf } from '../sessions/model-prompts.js'
import { DEFAULT_PROTECTION, PROTECTION_GROUPS } from '../sessions/protection.js'
import { placeholderIn } from '../sessions/prompt.js'
import type { CheckpointShares, OwnKey } from '../state.js'
import { DEFAULT_SHARES } from '../stats/checkpoint.js'
import { isTallyMode } from '../stats/mode.js'
import { DEFAULT_HIDDEN_SKILLS } from '../tools/settings.js'
import { DEFAULT_TRACKER } from '../tracker/adapters.js'
import { runLabelOf, type RunLabel } from '../tracker/model.js'
import { DEFAULT_UPDATES } from '../updates/release.js'
import { DEFAULT_ACCOUNTS, DEFAULT_CI, DEFAULT_CLI, DEFAULT_COMPARE, DEFAULT_CONTEXT, DEFAULT_EXECUTION, DEFAULT_MODELS } from './defaults.js'

/** `global` — Even Keel's own value, the top level of the file; `project` — a project's, its entry in `projects`. */
export type Scope = 'global' | 'project'
export type Kind = 'boolean' | 'integer' | 'number' | 'string' | 'enum' | 'list' | 'json'
export type TaskLabel = 'run' | 'checkpoint'

/** Where a value is set, for the messages: the project's key (not its id) and the qualifier, `''` when the key has none. */
export interface Place {
  project: string | null
  qualifier: string
}

export interface CheckContext {
  /** The trackers the repository has adapters for. */
  trackers: string[]
}

export interface SettingDefinition {
  /** The JSON path in the file: `ci.fixTask`, `models`. */
  key: string
  kind: Kind
  scopes: readonly Scope[]
  /** A map whose entries merge across levels one by one; the qualifier is the entry's key. */
  qualifier?: 'provider'
  /** The parser of the task's labels that feeds the task level. */
  taskLabel?: TaskLabel
  /** The fields of `EvenKeelConfig` the value ends up in. */
  lands: readonly (keyof EvenKeelConfig)[]
  /** The built-in value, by qualifier for a qualified key; `undefined` when the code computes it from other settings. */
  default: unknown
  /** The value checked and normalized; `undefined` for one that says nothing, as a blank model. Throws a `config.*` notice. */
  check: (value: unknown, place: Place, context: CheckContext) => unknown
}

/** A nested object of the file: what its unknown keys are, `undefined` where they are let through. */
export interface ObjectDefinition {
  unknown?: (where: string, key: string, known: string[]) => Error
}

const json = (value: unknown) => String(JSON.stringify(value))
export const at = ({ project }: Place, path: string) => (project === null ? path : `${project}.${path}`)

const boolean = (path: string) => (value: unknown, place: Place) => {
  if (typeof value !== 'boolean') throw fail('config.brief', { where: at(place, path) })
  return value
}

const statuses = (key: 'active' | 'terminal') => (value: unknown, place: Place) => (value === null ? null : labels(key)(value, place))

const labels = (key: string) => (value: unknown, place: Place) => {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || name.trim() === '')) throw fail('config.ruleList', { where: at(place, 'chain'), key })
  return value.map((name: string) => name.trim())
}

const providerName = (path: string) => (value: unknown, place: Place) => {
  if (!isProvider(place.qualifier)) throw fail('config.providerKey', { where: at(place, path), key: place.qualifier, known: [...PROVIDERS] })
  if (typeof value !== 'string') throw fail('config.providerName', { where: at(place, `${path}.${place.qualifier}`) })
  return value.trim() === '' ? undefined : value.trim()
}

const language = (path: string) => (value: unknown, place: Place) => {
  if (!isLanguage(value)) throw fail('config.language', { where: at(place, path), value: json(value), known: [...LANGUAGES] })
  return value
}

const percent = (value: unknown) => {
  if (!(typeof value === 'number' && value > 0 && value <= 100)) throw fail('config.contextPercents', {})
  return value
}

const COMPARE_LIMITS = { minTasks: 10_000, minSessions: 10_000, days: 365 } as const
/** The checkpoint hook asks the service for its threshold only from this context size on. */
const CHECKPOINT_ASK_FROM = 100_000

const compare = (key: keyof typeof COMPARE_LIMITS): SettingDefinition => ({
  key: `stats.compare.${key}`,
  kind: 'integer',
  scopes: ['global'],
  lands: ['stats'],
  default: DEFAULT_COMPARE[key],
  check: (value) => {
    const limit = COMPARE_LIMITS[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > limit) throw fail('config.compareValue', { key, limit, value: String(value) })
    return value
  },
})

/** A share is checked alone here; their order, on the values a project ends up with, in `parseConfig`. */
const checkpointShare = (key: keyof CheckpointShares): SettingDefinition => ({
  key: `stats.checkpointShares.${key}`,
  kind: 'integer',
  scopes: ['global', 'project'],
  lands: ['stats', 'settings'],
  default: DEFAULT_SHARES[key],
  check: (value, place) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
      throw fail('config.checkpointShare', { where: at(place, `stats.checkpointShares.${key}`), value: json(value) })
    }
    return value
  },
})

const command = (key: 'beforeStart' | 'check' | 'afterGreen'): SettingDefinition => ({
  key: `commands.${key}`,
  kind: 'list',
  scopes: ['project'],
  lands: ['settings'],
  default: [],
  check: (value, place) => {
    if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) throw fail('config.commandList', { where: at(place, `commands.${key}`) })
    return value.map((line: string) => line.trim()).filter((line) => line !== '')
  },
})

const ciSwitch = (key: 'guard' | 'recheckMain' | 'fixTask'): SettingDefinition => ({
  key: `ci.${key}`,
  kind: 'boolean',
  scopes: ['global', 'project'],
  lands: ['settings'],
  default: DEFAULT_CI[key],
  check: boolean(`ci.${key}`),
})

const rule = (key: keyof ChainRules): SettingDefinition => ({
  key: `chain.${key}`,
  kind: 'list',
  scopes: ['global', 'project'],
  lands: ['chain', 'rules'],
  default: DEFAULT_RULES[key],
  check: key === 'active' || key === 'terminal' ? statuses(key) : labels(key),
})

const update = (key: 'check' | 'notify'): SettingDefinition => ({
  key: `updates.${key}`,
  kind: 'boolean',
  scopes: ['global'],
  lands: ['updates'],
  default: DEFAULT_UPDATES[key],
  check: boolean(`updates.${key}`),
})

const context = (key: 'window' | 'warn' | 'danger'): SettingDefinition => ({
  key: `context.${key}`,
  kind: key === 'window' ? 'integer' : 'number',
  scopes: ['global'],
  lands: ['context'],
  default: DEFAULT_CONTEXT[key],
  check:
    key === 'window'
      ? (value) => {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw fail('config.contextWindow', { value: String(value) })
          return value
        }
      : percent,
})

/** Every setting of Even Keel, in the order of the file. Project record fields (`id`, `key`, `name`, `repo`, `branch`, the tracker's project) are not here. */
export const DEFINITIONS: readonly SettingDefinition[] = [
  { key: 'protection', kind: 'json', scopes: ['global', 'project'], lands: ['protection', 'settings'], default: DEFAULT_PROTECTION, check: (value, place) => {
    const invalid = () => fail('config.protection', { where: at(place, 'protection') })
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid()
    const fields = value as Record<string, unknown>
    for (const [key, entries] of Object.entries(fields)) {
      if (!['disabled', 'claude', 'codex', 'copilot', 'opencode'].includes(key) || !Array.isArray(entries)) throw invalid()
      if (key === 'codex') {
        if (entries.some(entry => !Array.isArray(entry) || entry.length === 0 || entry.some(arg => typeof arg !== 'string' || arg.length === 0))) throw invalid()
      } else if (entries.some(entry => typeof entry !== 'string' || entry.trim() === '')) throw invalid()
      if (key === 'disabled' && entries.some(entry => !PROTECTION_GROUPS.includes(entry))) throw invalid()
    }
    return fields
  } },
  { key: 'allowedHosts', kind: 'list', scopes: ['global'], lands: ['allowedHosts'], default: [], check: (value) => {
    const names = Array.isArray(value) ? value.map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : '')) : ['']
    if (names.some((name) => name === '' || /[/\\@?#\s]/.test(name))) throw fail('config.allowedHosts', {})
    return names
  } },
  { key: 'parallel', kind: 'integer', scopes: ['global'], lands: ['parallel'], default: 1, check: (value) => {
    if (!Number.isInteger(value) || (value as number) < 1) throw fail('config.parallel', { value: json(value) })
    return value
  } },
  // Off until its live check (BTN-437): each ping spends the account's limits.
  { key: 'keepWarm', kind: 'integer', scopes: ['global'], lands: ['keepWarm'], default: 0, check: (value) => {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_KEEP_WARM_HOURS) {
      throw fail('config.keepWarm', { value: json(value), max: String(MAX_KEEP_WARM_HOURS) })
    }
    return value
  } },
  // Off for users: each run spends the account's limits (BTN-569).
  { key: 'cliCheck', kind: 'boolean', scopes: ['global'], lands: ['cliCheck'], default: false, check: boolean('cliCheck') },
  { key: 'unattended', kind: 'boolean', scopes: ['global'], lands: ['unattended'], default: false, check: boolean('unattended') },
  { key: 'trimTools', kind: 'boolean', scopes: ['global'], lands: ['trimTools'], default: true, check: boolean('trimTools') },
  // A project's own only (BTN-345): a shared default silently moved every project that named none.
  { key: 'tracker', kind: 'enum', scopes: ['project'], lands: ['trackers'], default: DEFAULT_TRACKER, check: (value, place, { trackers }) => {
    const where = at(place, 'tracker')
    if (typeof value !== 'string' || value.trim() === '') throw fail('config.trackerName', { where })
    const name = value.trim().toLowerCase()
    if (!trackers.includes(name)) throw fail('config.trackerUnknown', { where, name, known: trackers })
    return name
  } },
  // `null` — on exactly when no package of the project brings its tracker's MCP server (BTN-225).
  { key: 'brief', kind: 'boolean', scopes: ['global', 'project'], lands: ['brief', 'briefs'], default: null, check: (value, place) => {
    if (value !== null && typeof value !== 'boolean') throw fail('config.briefValue', { where: at(place, 'brief') })
    return value
  } },
  rule('active'),
  rule('terminal'),
  rule('requiredLabels'),
  rule('excludedLabels'),
  rule('requiredMilestones'),
  rule('excludedMilestones'),
  { key: 'provider', kind: 'enum', scopes: ['global', 'project'], taskLabel: 'run', lands: ['provider', 'settings'], default: DEFAULT_PROVIDER, check: (value, place) => {
    const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (!isProvider(name)) throw fail('config.provider', { where: at(place, 'provider'), value: json(value), known: [...PROVIDERS] })
    return name
  } },
  { key: 'models', kind: 'string', scopes: ['global', 'project'], qualifier: 'provider', taskLabel: 'run', lands: ['models', 'settings'], default: DEFAULT_MODELS, check: providerName('models') },
  { key: 'accounts', kind: 'string', scopes: ['global', 'project'], qualifier: 'provider', lands: ['accounts', 'settings'], default: DEFAULT_ACCOUNTS, check: providerName('accounts') },
  { key: 'execution', kind: 'enum', scopes: ['global'], qualifier: 'provider', lands: ['execution'], default: DEFAULT_EXECUTION, check: (value, { qualifier: provider }) => {
    const known = EXECUTION_MODES[provider]
    if (known === undefined) throw fail('config.providerKey', { where: 'execution', key: provider, known: Object.keys(EXECUTION_MODES) })
    if (typeof value !== 'string' || !known.includes(value)) throw fail('config.execution', { provider, value: json(value), known: [...known] })
    return value
  } },
  { key: 'cli', kind: 'enum', scopes: ['global'], qualifier: 'provider', lands: ['cli'], default: DEFAULT_CLI, check: (value, { qualifier: provider }) => {
    if (!PINNED_PROVIDERS.includes(provider)) throw fail('config.providerKey', { where: 'cli', key: provider, known: [...PINNED_PROVIDERS] })
    if (typeof value !== 'string' || !CLI_SOURCES.includes(value)) throw fail('config.cli', { provider, value: json(value), known: [...CLI_SOURCES] })
    return value
  } },
  { key: 'modelLabels', kind: 'boolean', scopes: ['global', 'project'], lands: ['modelLabels', 'settings'], default: false, check: boolean('modelLabels') },
  { key: 'modelPrompts', kind: 'json', scopes: ['global'], lands: ['modelPrompts'], default: {}, check: (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail('config.modelPrompts', {})
    const prompts: Record<string, string> = {}
    for (const [model, text] of Object.entries(value)) {
      if (promptPatternOf(model) === null) throw fail('config.modelPrompts', {})
      if (typeof text !== 'string' || text.trim() === '') throw fail('config.modelPromptEmpty', { model })
      const placeholder = placeholderIn(text)
      if (placeholder !== null) throw fail('config.modelPromptPlaceholder', { model, placeholder })
      prompts[model.trim()] = text.trim()
    }
    return prompts
  } },
  { key: 'language', kind: 'enum', scopes: ['global'], lands: ['language', 'promptLanguage'], default: null, check: language('language') },
  { key: 'promptLanguage', kind: 'enum', scopes: ['global', 'project'], lands: ['promptLanguage', 'settings'], default: undefined, check: language('promptLanguage') },
  { key: 'hiddenSkills', kind: 'list', scopes: ['global'], lands: ['hiddenSkills'], default: DEFAULT_HIDDEN_SKILLS, check: (value) => {
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || name.trim() === '')) throw fail('config.hiddenSkills', {})
    return value.map((name: string) => name.trim())
  } },
  { key: 'cacheTtl', kind: 'enum', scopes: ['global', 'project'], lands: ['cacheTtl', 'settings'], default: null, check: (value) => {
    if (value !== null && value !== '5m' && value !== '1h') throw fail('config.cacheTtl', { value: json(value) })
    return value
  } },
  { key: 'autoCompactWindow', kind: 'integer', scopes: ['global', 'project'], lands: ['autoCompactWindow', 'settings'], default: null, check: (value) => {
    if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) throw fail('config.autoCompactWindow', { value: json(value) })
    return value
  } },
  context('window'),
  context('warn'),
  context('danger'),
  compare('minTasks'),
  compare('minSessions'),
  compare('days'),
  { key: 'stats.moves', kind: 'json', scopes: ['global'], lands: ['stats'], default: {}, check: (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail('config.notObject', { where: 'stats.moves' })
    for (const [from, to] of Object.entries(value)) {
      if (from.trim() === '' || typeof to !== 'string' || to.trim() === '') throw fail('config.statsMove', { from })
    }
    return value
  } },
  { key: 'stats.otherBelow', kind: 'number', scopes: ['global'], lands: ['stats'], default: 0, check: (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw fail('config.otherBelow', { value: json(value) })
    return value
  } },
  // Off — the checkpoint hook asks for no handoff by context size, the agent's own compaction keeps the context (BTN-255).
  { key: 'contextHandoffs', kind: 'boolean', scopes: ['global', 'project'], lands: ['contextHandoffs', 'settings'], default: true, check: boolean('contextHandoffs') },
  { key: 'stats.checkpointTokens', kind: 'integer', scopes: ['global', 'project'], taskLabel: 'checkpoint', lands: ['stats', 'settings'], default: null, check: (value) => {
    if (value !== null && (!Number.isInteger(value) || (value as number) < CHECKPOINT_ASK_FROM)) throw fail('config.checkpointTokens', { from: CHECKPOINT_ASK_FROM, value: json(value) })
    return value
  } },
  checkpointShare('first'),
  checkpointShare('late'),
  checkpointShare('hard'),
  // `null` — not chosen yet: Tally collects nothing and creates nothing until the page's setup or the settings choose (BTN-247).
  { key: 'tally', kind: 'enum', scopes: ['global'], lands: ['tally'], default: null, check: (value) => {
    if (value !== null && !isTallyMode(value)) throw fail('tally.mode', { value: json(value) })
    return value
  } },
  update('check'),
  update('notify'),
  { key: 'slot', kind: 'integer', scopes: ['project'], lands: ['slots'], default: false, check: (value, { project }) => {
    if (typeof value !== 'boolean' && !(Number.isInteger(value) && (value as number) > 0)) throw fail('config.slot', { key: project ?? '' })
    return value
  } },
  // No default: a project without its own color gets a free one (`colorsOf`).
  { key: 'color', kind: 'integer', scopes: ['project'], lands: ['colors'], default: undefined, check: (value, { project }) => {
    if (!isColor(value)) throw fail('config.color', { key: project ?? '' })
    return value
  } },
  // The levels add up rather than override (BTN-338): a project's `settings.prompt` is only its own row, Even Keel's is `prompt`.
  { key: 'prompt', kind: 'string', scopes: ['global', 'project'], lands: ['prompt', 'settings'], default: null, check: (value, place) => {
    if (typeof value !== 'string') throw fail('config.projectPrompt', { where: at(place, 'prompt') })
    return value.trim() === '' ? null : value.trim()
  } },
  command('beforeStart'),
  command('check'),
  command('afterGreen'),
  ciSwitch('guard'),
  { key: 'ci.kinds', kind: 'list', scopes: ['global', 'project'], lands: ['settings'], default: DEFAULT_CI.kinds, check: (value, place) => {
    if (!Array.isArray(value) || value.some((kind) => !(CI_KINDS as readonly unknown[]).includes(kind))) throw fail('config.ciKinds', { where: at(place, 'ci.kinds'), known: [...CI_KINDS] })
    return CI_KINDS.filter((kind) => value.includes(kind))
  } },
  { key: 'ci.waitMinutes', kind: 'integer', scopes: ['global', 'project'], lands: ['settings'], default: DEFAULT_CI.waitMinutes, check: (value, place) => {
    if (value !== null && !(Number.isInteger(value) && (value as number) >= 0)) throw fail('config.ciWait', { where: at(place, 'ci.waitMinutes') })
    return value
  } },
  ciSwitch('recheckMain'),
  ciSwitch('fixTask'),
  { key: 'remoteProfiles', kind: 'json', scopes: ['project'], lands: ['settings'], default: {}, check: (value, place) => {
    const problem = () => fail('config.remoteProfiles', { where: at(place, 'remoteProfiles'), known: [...CI_KINDS] })
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw problem()
    const chosen: RemoteProfiles = {}
    for (const [kind, id] of Object.entries(value)) {
      if (!(CI_KINDS as readonly string[]).includes(kind) || (id !== null && typeof id !== 'string')) throw problem()
      if (typeof id === 'string' && id.trim() !== '') chosen[kind as CiKind] = id.trim()
    }
    return chosen
  } },
  // A release project (BTN-172): the key of the project its branch merges into; `null` — a main project. Checked against the other projects in `parseConfig`.
  { key: 'mergeInto', kind: 'string', scopes: ['project'], lands: ['settings'], default: null, check: (value, place) => {
    if (value !== null && typeof value !== 'string') throw fail('config.mergeIntoValue', { where: at(place, 'mergeInto') })
    return value === null || value.trim() === '' ? null : value.trim()
  } },
  // A release project's carry conflict goes to the agent's session by itself (BTN-370); unattended mode does so too.
  { key: 'carryAgent', kind: 'boolean', scopes: ['project'], lands: ['settings'], default: false, check: boolean('carryAgent') },
  { key: 'pullRequests', kind: 'boolean', scopes: ['project'], lands: ['settings'], default: false, check: boolean('pullRequests') },
  // The GitHub label whose issues the project takes into its tracker (BTN-262); `null` — none.
  { key: 'intakeLabel', kind: 'string', scopes: ['project'], lands: ['settings'], default: null, check: (value, place) => {
    if (value !== null && typeof value !== 'string') throw fail('config.intakeLabel', { where: at(place, 'intakeLabel') })
    return value === null || value.trim() === '' ? null : value.trim()
  } },
  { key: 'fillMilestone', kind: 'boolean', scopes: ['global', 'project'], lands: ['settings'], default: false, check: boolean('fillMilestone') },
  { key: 'changelog', kind: 'string', scopes: ['project'], lands: ['settings'], default: DEFAULT_CHANGELOG, check: (value, place) => {
    const path = typeof value === 'string' ? changelogPath(value) : null
    if (path === null) throw fail('config.changelogPath', { where: at(place, 'changelog'), value: json(value) })
    return path
  } },
  // The project's standards (BTN-359): a document of the repository and the files it guards; read by the `checkpoint` plugin's hooks.
  { key: 'standards', kind: 'json', scopes: ['project'], lands: ['settings'], default: [], check: (value, place) => {
    const found = standardsOf(value)
    if (found === null) throw fail('config.standards', { where: at(place, 'standards') })
    return found
  } },
]

export const CHECKPOINT_SHARE_KEYS = ['stats.checkpointShares.first', 'stats.checkpointShares.late', 'stats.checkpointShares.hard'] as const satisfies readonly OwnKey[]

/** The keys of `ProjectSettings.own`: set at both levels, shown by the project's panel as its own or "as shared". */
export const OWN_KEYS: readonly OwnKey[] = ['protection', 'ci.guard', 'ci.kinds', 'ci.waitMinutes', 'ci.recheckMain', 'ci.fixTask', 'fillMilestone', 'promptLanguage', 'cacheTtl', 'autoCompactWindow', 'contextHandoffs', 'stats.checkpointTokens', ...CHECKPOINT_SHARE_KEYS]

/** The nested objects of the file whose parts are settings of their own. */
export const OBJECTS: Readonly<Record<string, ObjectDefinition>> = {
  chain: { unknown: (where, key) => fail('config.ruleKey', { where, key }) },
  context: {},
  stats: {},
  'stats.compare': { unknown: (_, key) => fail('config.compareKey', { key }) },
  'stats.checkpointShares': { unknown: (where, key, known) => fail('config.checkpointShareKey', { where, key, known }) },
  updates: { unknown: (_, key, known) => fail('config.updatesKey', { key, known }) },
  commands: { unknown: (where, key, known) => fail('config.commandKey', { where, key, known }) },
  ci: { unknown: (where, key, known) => fail('config.ciKey', { where, key, known }) },
}

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]))

export function definitionOf(key: string): SettingDefinition {
  const definition = BY_KEY.get(key)
  if (definition === undefined) throw new Error(`settings: no setting ${key}`)
  return definition
}

/** The built-in value of the key, a fresh copy; of one entry for a qualified key. */
export function defaultOf(key: string, qualifier = ''): unknown {
  const { default: value, qualifier: qualified } = definitionOf(key)
  const own = qualified === undefined ? value : (value as Record<string, unknown>)[qualifier]
  return own === undefined ? undefined : structuredClone(own)
}

/** A value a task's label sets: one entry of a qualified key, or a whole value with qualifier `''`. */
export interface LabelValue {
  key: string
  qualifier: string
  value: unknown
}

export interface LabelParser {
  /** The setting that switches the parser on; it reads nothing while that is off. */
  switch?: string
  /** The values the labels set, or the labels that contradict each other. */
  read: (labels: string[]) => { values: LabelValue[] } | { clash: string[] }
}

export const LABEL_PARSERS: Readonly<Record<TaskLabel, LabelParser>> = {
  checkpoint: {
    read: (labels) => {
      const found = labels.filter((label) => ['break | compaction', 'break | handoff'].includes(label.trim().toLowerCase()))
      const choices = new Set(found.map((label) => label.trim().toLowerCase()))
      if (choices.size > 1) return { clash: found }
      return { values: choices.has('break | compaction') ? [{ key: 'stats.checkpointTokens', qualifier: '', value: 999_999 }] : [] }
    },
  },
  run: {
    switch: 'modelLabels',
    read: (labels) => {
      const found = labels.flatMap((label) => {
        const run = runLabelOf(label)
        return run === null ? [] : [[label, run] as [string, RunLabel]]
      })
      if (found.length > 1) return { clash: found.map(([label]) => label) }
      const run = found[0]?.[1]
      if (run === undefined) return { values: [] }
      const model = run.model === null ? [] : [{ key: 'models', qualifier: run.provider, value: run.model }]
      return { values: [{ key: 'provider', qualifier: '', value: run.provider }, ...model] }
    },
  },
}
