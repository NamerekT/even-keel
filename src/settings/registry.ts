import { EXECUTION_MODES, DEFAULT_PROVIDER, isProvider, PROVIDERS } from '../agent/providers.js'
import { DEFAULT_RULES } from '../chain/rules.js'
import { CI_KINDS } from '../ci/model.js'
import type { EvenKeelConfig } from '../config.js'
import { isLanguage, LANGUAGES } from '../language.js'
import { fail } from '../notice/notice.js'
import { placeholderIn } from '../sessions/prompt.js'
import { DEFAULT_HIDDEN_SKILLS } from '../tools/settings.js'
import { DEFAULT_TRACKER } from '../tracker/adapters.js'
import { runLabelOf, type RunLabel } from '../tracker/model.js'
import { compareVersions, DEFAULT_UPDATES } from '../updates/release.js'
import { DEFAULT_ACCOUNTS, DEFAULT_CI, DEFAULT_COMPARE, DEFAULT_CONTEXT, DEFAULT_EXECUTION, DEFAULT_MODELS } from './defaults.js'

/** `global` — Even Keel's own value, the top level of the file; `project` — a project's, its entry in `projects`. */
export type Scope = 'global' | 'project'
export type Kind = 'boolean' | 'integer' | 'number' | 'string' | 'enum' | 'list' | 'json'
export type TaskLabel = 'run'

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

const language = (path: string) => (value: unknown) => {
  if (!isLanguage(value)) throw fail('config.language', { where: path, value: json(value), known: [...LANGUAGES] })
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
  scopes: ['project'],
  lands: ['settings'],
  default: DEFAULT_CI[key],
  check: boolean(`ci.${key}`),
})

const rule = (key: 'active' | 'terminal' | 'requiredLabels' | 'excludedLabels'): SettingDefinition => ({
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
  { key: 'allowedHosts', kind: 'list', scopes: ['global'], lands: ['allowedHosts'], default: [], check: (value) => {
    const names = Array.isArray(value) ? value.map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : '')) : ['']
    if (names.some((name) => name === '' || /[/\\@?#\s]/.test(name))) throw fail('config.allowedHosts', {})
    return names
  } },
  { key: 'parallel', kind: 'integer', scopes: ['global'], lands: ['parallel'], default: 1, check: (value) => {
    if (!Number.isInteger(value) || (value as number) < 1) throw fail('config.parallel', { value: json(value) })
    return value
  } },
  { key: 'tracker', kind: 'enum', scopes: ['global', 'project'], lands: ['tracker', 'trackers'], default: DEFAULT_TRACKER, check: (value, place, { trackers }) => {
    const where = at(place, 'tracker')
    if (typeof value !== 'string' || value.trim() === '') throw fail('config.trackerName', { where })
    const name = value.trim().toLowerCase()
    if (!trackers.includes(name)) throw fail('config.trackerUnknown', { where, name, known: trackers })
    return name
  } },
  { key: 'brief', kind: 'boolean', scopes: ['global', 'project'], lands: ['brief', 'briefs'], default: true, check: boolean('brief') },
  rule('active'),
  rule('terminal'),
  rule('requiredLabels'),
  rule('excludedLabels'),
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
  { key: 'modelLabels', kind: 'boolean', scopes: ['global', 'project'], lands: ['modelLabels', 'settings'], default: false, check: boolean('modelLabels') },
  { key: 'modelPrompts', kind: 'json', scopes: ['global'], lands: ['modelPrompts'], default: {}, check: (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail('config.modelPrompts', {})
    const prompts: Record<string, string> = {}
    for (const [model, text] of Object.entries(value)) {
      if (model.trim() === '') throw fail('config.modelPrompts', {})
      if (typeof text !== 'string' || text.trim() === '') throw fail('config.modelPromptEmpty', { model })
      const placeholder = placeholderIn(text)
      if (placeholder !== null) throw fail('config.modelPromptPlaceholder', { model, placeholder })
      prompts[model.trim()] = text.trim()
    }
    return prompts
  } },
  { key: 'language', kind: 'enum', scopes: ['global'], lands: ['language', 'promptLanguage'], default: null, check: language('language') },
  { key: 'promptLanguage', kind: 'enum', scopes: ['global'], lands: ['promptLanguage'], default: undefined, check: language('promptLanguage') },
  { key: 'hiddenSkills', kind: 'list', scopes: ['global'], lands: ['hiddenSkills'], default: DEFAULT_HIDDEN_SKILLS, check: (value) => {
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || name.trim() === '')) throw fail('config.hiddenSkills', {})
    return value.map((name: string) => name.trim())
  } },
  { key: 'cacheTtl', kind: 'enum', scopes: ['global'], lands: ['cacheTtl'], default: null, check: (value) => {
    if (value !== null && value !== '5m' && value !== '1h') throw fail('config.cacheTtl', { value: json(value) })
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
  { key: 'stats.checkpointTokens', kind: 'integer', scopes: ['global'], lands: ['stats'], default: null, check: (value) => {
    if (value !== null && (!Number.isInteger(value) || (value as number) < CHECKPOINT_ASK_FROM)) throw fail('config.checkpointTokens', { from: CHECKPOINT_ASK_FROM, value: json(value) })
    return value
  } },
  update('check'),
  update('notify'),
  { key: 'updates.dismissed', kind: 'string', scopes: ['global'], lands: ['updates'], default: DEFAULT_UPDATES.dismissed, check: (value) => {
    if (value !== null && (typeof value !== 'string' || compareVersions(value, value) === null)) throw fail('config.updatesDismissed', { value: json(value) })
    return value
  } },
  { key: 'slot', kind: 'integer', scopes: ['project'], lands: ['slots'], default: false, check: (value, { project }) => {
    if (typeof value !== 'boolean' && !(Number.isInteger(value) && (value as number) > 0)) throw fail('config.slot', { key: project ?? '' })
    return value
  } },
  { key: 'prompt', kind: 'string', scopes: ['project'], lands: ['settings'], default: null, check: (value, place) => {
    if (typeof value !== 'string') throw fail('config.projectPrompt', { where: at(place, 'prompt') })
    return value.trim() === '' ? null : value.trim()
  } },
  command('beforeStart'),
  command('check'),
  command('afterGreen'),
  ciSwitch('guard'),
  { key: 'ci.kinds', kind: 'list', scopes: ['project'], lands: ['settings'], default: DEFAULT_CI.kinds, check: (value, place) => {
    if (!Array.isArray(value) || value.some((kind) => !(CI_KINDS as readonly unknown[]).includes(kind))) throw fail('config.ciKinds', { where: at(place, 'ci.kinds'), known: [...CI_KINDS] })
    return CI_KINDS.filter((kind) => value.includes(kind))
  } },
  { key: 'ci.waitMinutes', kind: 'integer', scopes: ['project'], lands: ['settings'], default: DEFAULT_CI.waitMinutes, check: (value, place) => {
    if (value !== null && !(Number.isInteger(value) && (value as number) >= 0)) throw fail('config.ciWait', { where: at(place, 'ci.waitMinutes') })
    return value
  } },
  ciSwitch('recheckMain'),
  ciSwitch('fixTask'),
  { key: 'fillMilestone', kind: 'boolean', scopes: ['project'], lands: ['settings'], default: false, check: boolean('fillMilestone') },
]

/** The nested objects of the file whose parts are settings of their own. */
export const OBJECTS: Readonly<Record<string, ObjectDefinition>> = {
  chain: { unknown: (where, key) => fail('config.ruleKey', { where, key }) },
  context: {},
  stats: {},
  'stats.compare': { unknown: (_, key) => fail('config.compareKey', { key }) },
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
