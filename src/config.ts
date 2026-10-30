import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shortId } from './chain/fix.js'
import { excludedOf, sameName, splitsMilestones, type ChainRules } from './chain/rules.js'
import type { Language } from './language.js'
import { fail } from './notice/notice.js'
import { colorsOf } from './projects/colors.js'
import type { PoolEntry } from './account/model.js'
import type { RunSettings } from './sessions/launch.js'
import type { CacheTtl, CheckpointShares, CiSettings, ContextScale, OwnKey, OwnValues, ProjectSettings, Standard, StatsConfig } from './state.js'
import { CI_KINDS, type RemoteProfiles } from './ci/model.js'
import { DEFAULT_CHANGELOG } from './changelog/file.js'
import { changesOf, type FormValue } from './settings/changes.js'
import { DEFAULT_BRANCH, DEFAULT_LANGUAGE } from './settings/defaults.js'
import type { Protection } from './sessions/protection.js'
import type { TallyMode } from './stats/mode.js'
import { fileRows, isPlainObject, PROJECT_KEY, writeRows } from './settings/file.js'
import { at, OWN_KEYS } from './settings/registry.js'
import { checkRows, inherit, resolve, type ProjectRecord, type Resolved, type Values } from './settings/resolve.js'
import { ADAPTERS } from './tracker/adapters.js'
import type { TrackerAdapter } from './tracker/source.js'
import type { UpdateSettings } from './updates/release.js'

export {
  CONFIG_FILE,
  DEFAULT_ACCOUNTS,
  DEFAULT_BRANCH,
  DEFAULT_CI,
  DEFAULT_COMPARE,
  DEFAULT_CONTEXT,
  DEFAULT_EXECUTION,
  DEFAULT_LANGUAGE,
  DEFAULT_MODELS,
} from './settings/defaults.js'
export { isPlainObject } from './settings/file.js'

export interface EvenKeelConfig {
  protection: Protection
  /** Names besides loopback and `EVEN_KEEL_HOST` the page may be reached by — a proxy's name, say. */
  allowedHosts: string[]
  /**
   * The repository of each project by its id, in the order of the file. Every map of a project here and in the service
   * names it by its id (a GUID that never changes, BTN-271): two projects may share a key.
   */
  projects: Record<string, string>
  /** The key of each project: what the page and the log show it by, and its tracker project unless one is named. */
  keys: Record<string, string>
  /** The names projects are shown by, only those that have one. */
  names: Record<string, string>
  /** The shared rules, defaults filled in; a project's own keys go over them into `rules`. */
  chain: ChainRules
  rules: Record<string, ChainRules>
  /** The rule keys each project sets itself; a tracker profile's rules go between the shared and these (`projectRules`). */
  ownRules: Record<string, Partial<ChainRules>>
  slots: Record<string, number>
  /** The palette slot of each project (`colorsOf`): its own `color` or a free one; a project past the free ones has none. */
  colors: Record<string, number>
  trackers: Record<string, string>
  trackerProjects: Record<string, string>
  /** The extra task feeds of each project that has any (BTN-66), in the order of its entry. */
  feeds: Record<string, Feed[]>
  /** The shared `brief`; `briefs` — what each project ends up with. `null` — left to the project's packages (`briefOn`). */
  brief: boolean | null
  briefs: Record<string, boolean | null>
  settings: Record<string, ProjectSettings>
  context: ContextScale
  /** The shared provider; a project's own `provider` goes over it. */
  provider: string
  /** The shared model by provider, defaults filled in; a project's own entries go over them. */
  models: Record<string, string>
  /** The shared account folder by provider, defaults filled in; the shared provider's entry is the active account of the header. */
  accounts: Record<string, string>
  /** The mode of each provider's sessions, defaults filled in; shared only: the Codex sandbox does not start under the service for any project. */
  execution: Record<string, string>
  /** Which CLI each provider's sessions run on (`CLI_SOURCES`), defaults filled in; shared only: an account folder has one daemon. */
  cli: Record<string, string>
  /** Whether the tasks' run labels are read, unless a project says otherwise. */
  modelLabels: boolean
  /** Appended in order to new sessions matching each provider / model pattern (`*` matches any string). */
  modelPrompts: Record<string, string>
  /** Appended to the prompt of every new session of every project, before the project's own `prompt`; null — none. */
  prompt: string | null
  stats: StatsConfig
  language: Language | null
  promptLanguage: Language
  /** Skills chain sessions get only for `/name` while trimming is on. */
  hiddenSkills: string[]
  /** The prompt cache TTL of chain sessions (`promptCacheTtl`); null leaves the CLI's own choice. A project's own goes over it. */
  cacheTtl: CacheTtl | null
  autoCompactWindow: number | null
  /** Handoffs by context size for every project without its own (BTN-255); what each ends up with is in `settings`. */
  contextHandoffs: boolean
  /** The shared `ci` keys and `fillMilestone`; what each project ends up with is in `settings`. */
  ci: CiSettings
  fillMilestone: boolean
  /** Chains run at once; the rest wait in the queue. */
  parallel: number
  /** Hours a waiting chain session's cache is kept warm after its last answer (BTN-437); 0 — off. */
  keepWarm: number
  /** Run `cli-check` in the service on a new CLI version and weekly (BTN-569); off by default — it spends limits. */
  cliCheck: boolean
  /** Even Keel's setting rows the chain's switches write (`chain/unattended`, `chain/trim`), not the forms. */
  unattended: boolean
  trimTools: boolean
  /** Where Tally writes, set by the page's stats setup and settings (`stats/tally`); `null` — not chosen yet. */
  tally: TallyMode | null
  /** The switches only: the version whose toast was closed is state (`service_state`). */
  updates: Pick<UpdateSettings, 'check' | 'notify'>
}

/**
 * An extra task feed of a project (BTN-66): a place of a tracker, maybe another tracker than the project's, whose tasks
 * join the project's chain. Its tasks keep their tracker's ids — on GitHub `<key>-<number>` — and a task finds its feed
 * by the prefix of its id, so no project or other feed gives that prefix (`feedPrefix`).
 */
export interface Feed {
  /** A GUID: the tracker layer reads the feed as a project of this id. */
  id: string
  tracker: string
  key: string
  /** The place in its tracker by the tracker's project key (`github`, `linear`); none where the key names it. */
  place?: string
}

export const RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels', 'requiredMilestones', 'excludedMilestones'] as const
/** Keys an older config had; the address now comes from `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT`. */
const IGNORED_KEYS = ['host', 'port'] as const
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4747
const DEFAULT_MCP_PORT = 4748

type AdapterShapes = Readonly<Record<string, Pick<TrackerAdapter, 'projectKey'>>>

/** The keys a project entry names its tracker's project by (`github`, `linear`). */
export const trackerKeysOf = (adapters: AdapterShapes) => [
  ...new Set(Object.values(adapters).flatMap(({ projectKey }) => (projectKey === undefined ? [] : [projectKey.key]))),
]

/** The file's project records and rows, each row checked by the registry, resolved into what the service runs on. */
export function parseConfig(raw: unknown, adapters: AdapterShapes = ADAPTERS): EvenKeelConfig {
  const { records, rows } = fileRows(raw, trackerKeysOf(adapters))
  return checkShared(configOf(records, resolve(records, checkRows(rows, records, { trackers: Object.keys(adapters) })), adapters), adapters)
}

const rulesOf = (values: Values): ChainRules => ({
  active: values['chain.active'] as string[] | null,
  terminal: values['chain.terminal'] as string[] | null,
  requiredLabels: values['chain.requiredLabels'] as string[],
  excludedLabels: values['chain.excludedLabels'] as string[],
  requiredMilestones: values['chain.requiredMilestones'] as string[],
  excludedMilestones: values['chain.excludedMilestones'] as string[],
})

/** The rule keys the project's own rows set: a tracker profile's rules do not go over them. */
const ownRulesOf = (own: Values): Partial<ChainRules> =>
  Object.fromEntries(RULE_KEYS.flatMap((key) => (own[`chain.${key}`] === undefined ? [] : [[key, own[`chain.${key}`]]])))

/**
 * The place in its tracker the project reads (`TrackerProjectKey.placeOf`), its key where the adapter has no such notion.
 * Projects with the same one read the tracker once.
 */
export function readKeyOf(config: Pick<EvenKeelConfig, 'keys' | 'trackers' | 'trackerProjects'>, project: string, adapters: AdapterShapes = ADAPTERS): string {
  return placeOf(config, project, adapters).read
}

/** The prefix of the project's task ids: its key, or the tracker's own where tasks keep the tracker's ids (`NAM` of `NAM-12`). */
export function idPrefixOf(config: Pick<EvenKeelConfig, 'keys' | 'trackers' | 'trackerProjects'>, project: string, adapters: AdapterShapes = ADAPTERS): string {
  return placeOf(config, project, adapters).ids
}

function placeOf(config: Pick<EvenKeelConfig, 'keys' | 'trackers' | 'trackerProjects'>, project: string, adapters: AdapterShapes) {
  const key = config.keys[project] ?? project
  const place = adapters[config.trackers[project] ?? '']?.projectKey?.placeOf
  return place === undefined ? { read: key, ids: key } : place(key, config.trackerProjects[project])
}

/**
 * What the log and the messages name a project by: its key, and where another project has the same key, the first of
 * its name, its branch and the start of its id that no such project shares.
 */
export function projectLabel(config: Pick<EvenKeelConfig, 'keys' | 'names' | 'settings'>, project: string): string {
  const key = config.keys[project]
  if (key === undefined) return project
  const others = Object.keys(config.keys).filter((other) => other !== project && config.keys[other] === key)
  if (others.length === 0) return key
  const apart = (pick: (each: string) => string | undefined) => {
    const mine = pick(project)
    return mine !== undefined && others.every((other) => pick(other) !== mine) ? mine : undefined
  }
  return `${key} (${apart((each) => config.names[each]) ?? apart((each) => config.settings[each]?.branch) ?? shortId(project)})`
}

/** The first project of each key, in the order of the file: Tally and the stats know a project by its key. */
export function firstByKey(config: Pick<EvenKeelConfig, 'keys'>): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [project, key] of Object.entries(config.keys)) found[key] ??= project
  return found
}

/** `projectLabel` of every project. */
export function projectLabels(config: Pick<EvenKeelConfig, 'keys' | 'names' | 'settings'>): Record<string, string> {
  return Object.fromEntries(Object.keys(config.keys).map((project) => [project, projectLabel(config, project)]))
}

/**
 * Projects on one tracker project must split its tasks by milestone, or both chains would take the same task. A release
 * project merges into another project that merges into none.
 */
function checkShared(config: EvenKeelConfig, adapters: AdapterShapes): EvenKeelConfig {
  const label = (project: string) => projectLabel(config, project)
  const seen = new Map<string, string[]>()
  for (const project of Object.keys(config.projects)) {
    const shared = `${config.trackers[project]}\u0000${readKeyOf(config, project, adapters)}`
    const others = seen.get(shared) ?? []
    const elsewhere = keyElsewhere(config, project, others, adapters)
    if (elsewhere !== undefined) {
      throw fail('config.keyElsewhere', { key: config.keys[project]!, project: label(project), other: label(elsewhere), trackerProject: config.trackerProjects[project] ?? '' })
    }
    const other = others.find((each) => !splitsMilestones(config.rules[each]!, config.rules[project]!))
    if (other !== undefined) throw fail('config.trackerProjectShared', { project: label(project), other: label(other), trackerProject: readKeyOf(config, project, adapters) })
    seen.set(shared, [...others, project])
  }
  for (const [project, { mergeInto: into }] of Object.entries(config.settings)) {
    if (into !== null && (into === project || config.settings[into] === undefined || config.settings[into].mergeInto !== null)) {
      throw fail('config.mergeInto', { project: label(project), into: config.keys[into] === undefined ? into : label(into) })
    }
  }
  checkFeeds(config, adapters)
  return config
}

/**
 * Another project of the same place with the key but another tracker project: on a tracker whose task ids are made of
 * the key (no `placeOf`, GitHub) the ids of its two repositories would clash.
 */
export function keyElsewhere(
  config: Pick<EvenKeelConfig, 'trackers' | 'trackerProjects'>,
  project: string,
  others: readonly string[],
  adapters: AdapterShapes = ADAPTERS,
): string | undefined {
  if (adapters[config.trackers[project] ?? '']?.projectKey?.placeOf !== undefined) return undefined
  return others.find((other) => config.trackerProjects[other] !== config.trackerProjects[project])
}

/**
 * The project `mergeInto` names: by its id, or by its key where no other project but the one merging has it — a release
 * project often shares its key with the project it merges into. Anything else stays as written for `checkShared`.
 */
export function mergeTargetOf(records: readonly Pick<ProjectRecord, 'id' | 'key'>[], self: string, into: string | null): string | null {
  if (into === null || records.some((record) => record.id === into)) return into
  const found = records.filter((record) => record.key === into && record.id !== self)
  return found.length === 1 ? found[0]!.id : into
}

function configOf(records: ProjectRecord[], { shared, own, values }: Resolved, adapters: AdapterShapes): EvenKeelConfig {
  const byId = <T>(pick: (record: ProjectRecord, values: Values, own: Values) => T | undefined): Record<string, T> =>
    Object.fromEntries(
      records.flatMap((record) => {
        const value = pick(record, values[record.id]!, own[record.id]!)
        return value === undefined ? [] : [[record.id, value]]
      }),
    )
  const context = { window: shared['context.window'], warn: shared['context.warn'], danger: shared['context.danger'] } as ContextScale
  if (context.warn >= context.danger) throw fail('config.contextPercents', {})
  const language = shared.language as Language | null
  const promptLanguage = (values: Values) => (values.promptLanguage as Language | undefined) ?? language ?? DEFAULT_LANGUAGE
  return {
    allowedHosts: shared.allowedHosts as string[],
    projects: byId((record) => record.repo),
    keys: byId((record) => record.key),
    names: byId((record) => record.name ?? undefined),
    chain: rulesOf(shared),
    rules: byId((record, project) => checkRules(rulesOf(project), record.key)),
    ownRules: byId((_, __, ownRows) => ownRulesOf(ownRows)),
    slots: byId((_, { slot }) => (slot === true ? 1 : typeof slot === 'number' ? slot : undefined)),
    colors: colorsOf(
      records.map((record) => record.id),
      byId((_, { color }) => color as number | undefined),
    ),
    trackers: byId((_, project) => project.tracker as string),
    trackerProjects: byId((record, project) => trackerProjectOf(record, project.tracker as string, adapters)),
    feeds: feedsOf(records, adapters),
    brief:shared.brief as boolean | null,
    briefs: byId((_, project) => project.brief as boolean | null),
    settings: byId((record, project, ownRows) => ({
      ...settingsOf(record, project, ownRows),
      mergeInto: mergeTargetOf(records, record.id, project.mergeInto as string | null),
      promptLanguage: promptLanguage(project),
    })),
    context,
    provider: shared.provider as string,
    models: shared.models as Record<string, string>,
    accounts: shared.accounts as Record<string, string>,
    execution: shared.execution as Record<string, string>,
    cli: shared.cli as Record<string, string>,
    modelLabels: shared.modelLabels as boolean,
    modelPrompts: shared.modelPrompts as Record<string, string>,
    prompt: shared.prompt as string | null,
    stats: {
      compare: { minTasks: shared['stats.compare.minTasks'], minSessions: shared['stats.compare.minSessions'], days: shared['stats.compare.days'] },
      moves: shared['stats.moves'],
      otherBelow: shared['stats.otherBelow'],
      checkpointTokens: shared['stats.checkpointTokens'],
      checkpointShares: sharesOf(shared, null),
    } as StatsConfig,
    language,
    promptLanguage: promptLanguage(shared),
    hiddenSkills: shared.hiddenSkills as string[],
    protection: shared.protection as Protection,
    cacheTtl: shared.cacheTtl as CacheTtl | null,
    autoCompactWindow: shared.autoCompactWindow as number | null,
    contextHandoffs: shared.contextHandoffs as boolean,
    ci: ciOf(shared),
    fillMilestone: shared.fillMilestone as boolean,
    parallel: shared.parallel as number,
    keepWarm: shared.keepWarm as number,
    cliCheck: shared.cliCheck as boolean,
    unattended: shared.unattended as boolean,
    trimTools: shared.trimTools as boolean,
    tally: shared.tally as TallyMode | null,
    updates: { check: shared['updates.check'] as boolean, notify: shared['updates.notify'] as boolean },
  }
}

const ciOf = (values: Values): CiSettings =>
  ({
    guard: values['ci.guard'],
    kinds: values['ci.kinds'],
    waitMinutes: values['ci.waitMinutes'],
    recheckMain: values['ci.recheckMain'],
    fixTask: values['ci.fixTask'],
  }) as CiSettings

/** The checkpoint shares a level ends up with, in order, or `config.checkpointShareOrder`; `project` — its key, `null` for the shared level. */
function sharesOf(values: Values, project: string | null): CheckpointShares {
  const shares = { first: values['stats.checkpointShares.first'], late: values['stats.checkpointShares.late'], hard: values['stats.checkpointShares.hard'] } as CheckpointShares
  if (shares.first >= shares.late || shares.late >= shares.hard) {
    throw fail('config.checkpointShareOrder', { where: at({ project, qualifier: '' }, 'stats.checkpointShares'), ...shares })
  }
  return shares
}

function settingsOf(record: ProjectRecord, values: Values, own: Values): Omit<ProjectSettings, 'promptLanguage'> {
  return {
    branch: record.branch,
    prompt: (own.prompt as string | undefined) ?? null,
    beforeStart: values['commands.beforeStart'] as string[],
    check: values['commands.check'] as string[],
    afterGreen: values['commands.afterGreen'] as string[],
    ci: ciOf(values),
    remoteProfiles: values.remoteProfiles as RemoteProfiles,
    pullRequests: values.pullRequests as boolean,
    intakeLabel: values.intakeLabel as string | null,
    mergeInto: values.mergeInto as string | null,
    carryAgent: values.carryAgent as boolean,
    fillMilestone: values.fillMilestone as boolean,
    changelog: values.changelog as string,
    standards: values.standards as Standard[],
    provider: (own.provider as string | undefined) ?? null,
    models: (own.models as Record<string, string> | undefined) ?? {},
    accounts: (own.accounts as Record<string, string> | undefined) ?? {},
    modelLabels: (own.modelLabels as boolean | undefined) ?? null,
    cacheTtl: values.cacheTtl as CacheTtl | null,
    autoCompactWindow: values.autoCompactWindow as number | null,
    contextHandoffs: values.contextHandoffs as boolean,
    protection: values.protection as Protection,
    checkpointTokens: values['stats.checkpointTokens'] as number | null,
    checkpointShares: sharesOf(values, record.key),
    own:Object.fromEntries(OWN_KEYS.flatMap((key) => (own[key] === undefined ? [] : [[key, own[key]]]))) as OwnValues,
  }
}

function trackerProjectOf(record: ProjectRecord, tracker: string, adapters: AdapterShapes): string | undefined {
  return placeOfEntry(record.trackerProjects, tracker, record.key, adapters)
}

/** The tracker's project key of an entry (a project's, a feed's), checked; `undefined` where the tracker has none or it is optional and not given. */
function placeOfEntry(fields: Record<string, unknown>, tracker: string, where: string, adapters: AdapterShapes): string | undefined {
  const projectKey = adapters[tracker]?.projectKey
  if (projectKey === undefined) return undefined
  const raw = fields[projectKey.key]
  if (projectKey.optional && raw === undefined) return undefined
  if (typeof raw !== 'string' || !projectKey.pattern.test(raw.trim())) throw fail('config.trackerProject', { where: `${where}.${projectKey.key}`, example: projectKey.example })
  return raw.trim()
}

/** Each project's feeds, checked by their trackers; a project without any is left out. A feed's id is unique among projects and feeds. */
function feedsOf(records: ProjectRecord[], adapters: AdapterShapes): Record<string, Feed[]> {
  const ids = new Map(records.map((record) => [record.id, record.key]))
  const feedOf = (raw: Record<string, unknown>, where: string): Feed => {
    const { id, tracker, key } = raw
    if (typeof id !== 'string' || id.trim() === '') throw fail('config.feedField', { where, field: 'id' })
    const first = ids.get(id)
    if (first !== undefined) throw fail('config.projectTwice', { field: 'id', value: JSON.stringify(id), first, second: where })
    ids.set(id, where)
    if (typeof tracker !== 'string') throw fail('config.trackerName', { where: `${where}.tracker` })
    if (adapters[tracker] === undefined) throw fail('config.trackerUnknown', { where: `${where}.tracker`, name: tracker, known: Object.keys(adapters) })
    if (typeof key !== 'string' || !PROJECT_KEY.test(key)) throw fail('config.projectKey', { where: `${where}.key`, value: String(JSON.stringify(key)) })
    const place = placeOfEntry(raw, tracker, where, adapters)
    return { id, tracker, key, ...(place === undefined ? {} : { place }) }
  }
  return Object.fromEntries(
    records.flatMap((record) => (record.feeds === undefined ? [] : [[record.id, record.feeds.map((raw, index) => feedOf(raw, `${record.key}.feeds[${index}]`))]])),
  )
}

/** What the tracker layer reads (BTN-66): every project, and every feed as a project of its own id on its owner's repository. */
export interface Readers extends Pick<EvenKeelConfig, 'projects' | 'keys' | 'trackers' | 'trackerProjects'> {
  /** The project of each feed, by the feed's id. */
  owners: Record<string, string>
}

const readersCache = new WeakMap<object, Readers>()

/** `Readers` of the config, made once per config object. */
export function readersOf(config: Pick<EvenKeelConfig, 'projects' | 'keys' | 'trackers' | 'trackerProjects' | 'feeds'>): Readers {
  const cached = readersCache.get(config)
  if (cached !== undefined) return cached
  const readers: Readers = {
    projects: { ...config.projects },
    keys: { ...config.keys },
    trackers: { ...config.trackers },
    trackerProjects: { ...config.trackerProjects },
    owners: {},
  }
  for (const [project, feeds] of Object.entries(config.feeds)) {
    for (const feed of feeds) {
      readers.owners[feed.id] = project
      readers.projects[feed.id] = config.projects[project]!
      readers.keys[feed.id] = feed.key
      readers.trackers[feed.id] = feed.tracker
      if (feed.place !== undefined) readers.trackerProjects[feed.id] = feed.place
    }
  }
  readersCache.set(config, readers)
  return readers
}

/** The project a reader serves: a feed's owner, a project itself. */
export const ownerOf = (readers: Pick<Readers, 'owners'>, reader: string): string => readers.owners[reader] ?? reader

/** The project and its feeds, in order: whose lists make its chain's. */
export const readerIds = (config: Pick<EvenKeelConfig, 'feeds'>, project: string): string[] => [project, ...(config.feeds[project] ?? []).map((feed) => feed.id)]

/** The reader of a task of the project: the feed whose ids its id carries, else the project itself. */
export function readerOf(config: Pick<EvenKeelConfig, 'projects' | 'keys' | 'trackers' | 'trackerProjects' | 'feeds'>, project: string, task: string, adapters: AdapterShapes = ADAPTERS): string {
  const feeds = config.feeds[project]
  if (feeds === undefined) return project
  const prefix = task.slice(0, task.lastIndexOf('-'))
  const readers = readersOf(config)
  return feeds.find((feed) => idPrefixOf(readers, feed.id, adapters) === prefix)?.id ?? project
}

/**
 * A feed's ids and its place are its own: no project or other feed gives its prefix — a task finds its feed by it — or
 * reads its place, or a task would enter the chain twice.
 */
function checkFeeds(config: EvenKeelConfig, adapters: AdapterShapes): void {
  const readers = readersOf(config)
  const label = (reader: string) => (readers.owners[reader] === undefined ? projectLabel(config, reader) : `${projectLabel(config, readers.owners[reader])} · ${readers.keys[reader]}`)
  const all = Object.keys(readers.projects)
  // A tracker without `placeOf` (GitHub) reads by the key: its place is the repository the key names.
  const place = (reader: string) => {
    const tracker = readers.trackers[reader]!
    const where = adapters[tracker]?.projectKey?.placeOf === undefined ? (readers.trackerProjects[reader] ?? readers.keys[reader]) : readKeyOf(readers, reader, adapters)
    return `${tracker}\u0000${where}`
  }
  for (const [project, feeds] of Object.entries(config.feeds)) {
    for (const feed of feeds) {
      const prefix = idPrefixOf(readers, feed.id, adapters)
      const others = all.filter((other) => other !== feed.id)
      const same = others.find((other) => idPrefixOf(readers, other, adapters) === prefix)
      if (same !== undefined) throw fail('config.feedPrefix', { project: projectLabel(config, project), prefix, other: label(same) })
      const twice = others.find((other) => place(other) === place(feed.id))
      if (twice !== undefined) throw fail('config.feedPlace', { project: projectLabel(config, project), other: label(twice) })
    }
  }
}

/** The rules, or the first name they put on both sides; `project` — what the message names the project by. */
export function checkRules(rules: ChainRules, project: string): ChainRules {
  const clash = (a: string[], b: string[]) => a.find((name) => b.some((other) => sameName(name, other)))
  const status = clash(rules.active ?? [], rules.terminal ?? [])
  if (status !== undefined) throw fail('config.statusBoth', { project, status })
  const label = clash(rules.requiredLabels, excludedOf(rules))
  if (label !== undefined) throw fail('config.labelBoth', { project, label })
  const milestone = clash(rules.requiredMilestones, rules.excludedMilestones)
  if (milestone !== undefined) throw fail('config.milestoneBoth', { project, milestone })
  return rules
}

/**
 * The raw config with an id given to every project entry that has none — one added by hand — and the keys of those
 * entries; the same object when there are none. The service writes the result back into the file.
 */
export function withIds(raw: unknown, newId: () => string = randomUUID): { raw: unknown; keys: string[] } {
  const projects = isPlainObject(raw) ? raw.projects : undefined
  if (!Array.isArray(projects)) return { raw, keys: [] }
  const keys: string[] = []
  const filled = projects.map((entry: unknown) => {
    if (!isPlainObject(entry) || entry.id !== undefined) return entry
    keys.push(String(entry.key))
    return { id: newId(), ...entry }
  })
  return keys.length === 0 ? { raw, keys } : { raw: { ...(raw as Record<string, unknown>), projects: filled }, keys }
}

/** Where the service listens: `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT`, loopback and 4747 without them. */
export function listenOf(env: NodeJS.ProcessEnv): { host: string; port: number } {
  const host = env.EVEN_KEEL_HOST?.trim() || DEFAULT_HOST
  const text = env.EVEN_KEEL_PORT?.trim() || String(DEFAULT_PORT)
  const port = /^\d+$/.test(text) ? Number(text) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('config.port', { value: text })
  return { host, port }
}

/** The port of the MCP gateway (`src/packages/gateway.ts`), always on 127.0.0.1. */
export function mcpPortOf(env: NodeJS.ProcessEnv): number {
  const text = env.EVEN_KEEL_MCP_PORT?.trim() || String(DEFAULT_MCP_PORT)
  const port = /^\d+$/.test(text) ? Number(text) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('config.mcpPort', { value: text })
  return port
}

/** The keys of the raw config that are no longer read. */
export function ignoredKeys(raw: unknown): string[] {
  return isPlainObject(raw) ? IGNORED_KEYS.filter((key) => Object.hasOwn(raw, key)) : []
}

/** What the project's sessions run on: its own provider, models, accounts and labels switch over the shared ones. */
export function runSettings(config: Pick<EvenKeelConfig, 'settings' | 'provider' | 'models' | 'accounts' | 'modelLabels'>, project: string | undefined): RunSettings {
  const own = project === undefined ? undefined : config.settings[project]
  return {
    provider: inherit('provider', config.provider, own?.provider ?? undefined) as string,
    models: inherit('models', config.models, own?.models) as Record<string, string>,
    accounts: inherit('accounts', config.accounts, own?.accounts) as Record<string, string>,
    labels: inherit('modelLabels', config.modelLabels, own?.modelLabels ?? undefined) as boolean,
  }
}

type PoolConfig = Pick<EvenKeelConfig, 'settings' | 'accounts'>

/** The pool entries of the config: the shared pool's, then each project's own. */
export function poolEntries(config: PoolConfig, projects: string[]): PoolEntry[] {
  const entries = (project: string | null, accounts: Record<string, string> | undefined) =>
    Object.entries(accounts ?? {}).map(([provider, account]) => ({ project, provider, account }))
  return [...entries(null, config.accounts), ...projects.flatMap((project) => entries(project, config.settings[project]?.accounts))]
}

/** The account folder each project's sessions run on by its provider (`runSettings`), as the projects on each folder. */
export function projectsByAccount(config: Parameters<typeof runSettings>[0], projects: string[]): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const project of projects) {
    const run = runSettings(config, project)
    const account = run.accounts[run.provider]
    if (account !== undefined) (found[account] ??= []).push(project)
  }
  return found
}

/** The providers sessions run on (`runSettings`): the shared one and each project's own. */
export function providersInUse(config: Parameters<typeof runSettings>[0], projects: string[]): Set<string> {
  return new Set([runSettings(config, undefined).provider, ...projects.map((project) => runSettings(config, project).provider)])
}

/** The config of the file, an entry without an id given one in memory only: for readers that do not write the file. */
export function loadConfig(file: string): EvenKeelConfig {
  return parseConfig(withIds(readRawConfig(file)).raw)
}

export function readRawConfig(file: string): unknown {
  const text = readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw fail('config.notJson', { file }, { detail: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * The values of a project's settings as rows of its level: what the project has of its own, `undefined` where it
 * inherits. `written` — the entry as it is in the file, whose by-provider entries the settings leave out go.
 */
export function projectSettingValues(settings: ProjectSettings, written: Record<string, unknown> = {}): FormValue[] {
  const value = (group: keyof ProjectSettings, key: string, own: unknown, fallback?: unknown): FormValue => ({ group, key, qualifier: '', value: own, fallback })
  const byProvider = (key: 'models' | 'accounts'): FormValue[] => {
    const names = settings[key]
    const providers = new Set([...Object.keys(isPlainObject(written[key]) ? written[key] : {}), ...Object.keys(names)])
    return [...providers].map((provider) => ({ group: key, key, qualifier: provider, value: names[provider]?.trim() || undefined }))
  }
  const own = (key: OwnKey): FormValue => {
    const kinds = settings.own['ci.kinds']
    return { group: `own.${key}`, key, qualifier: '', value: key === 'ci.kinds' && kinds !== undefined ? CI_KINDS.filter((kind) => kinds.includes(kind)) : settings.own[key] }
  }
  return [
    value('prompt', 'prompt', settings.prompt?.trim() || undefined),
    ...(['beforeStart', 'check', 'afterGreen'] as const).map((key) =>
      value(key, `commands.${key}`, settings[key].map((line) => line.trim()).filter((line) => line !== ''), []),
    ),
    ...OWN_KEYS.map(own),
    value('remoteProfiles', 'remoteProfiles', settings.remoteProfiles, {}),
    value('pullRequests', 'pullRequests', settings.pullRequests, false),
    value('intakeLabel', 'intakeLabel', settings.intakeLabel?.trim() || undefined),
    value('mergeInto', 'mergeInto', settings.mergeInto?.trim() || undefined),
    value('carryAgent', 'carryAgent', settings.carryAgent, false),
    value('changelog', 'changelog', settings.changelog, DEFAULT_CHANGELOG),
    value('standards', 'standards', settings.standards, []),
    value('provider', 'provider', settings.provider ?? undefined),
    ...byProvider('models'),
    ...byProvider('accounts'),
    value('modelLabels', 'modelLabels', settings.modelLabels ?? undefined),
  ]
}

/**
 * The project's entry in the config file with `branch`, `prompt`, `commands`, `provider`, `models`, `accounts`,
 * `modelLabels` and the keys of `own` set, or removed when empty or inherited; its other keys stay, and so do the
 * settings `changed` leaves out. The group of an own key is `own.<key>`.
 */
export function withProjectSettings(
  entry: unknown,
  settings: ProjectSettings,
  changed: (field: keyof ProjectSettings | `own.${OwnKey}`) => boolean = () => true,
): Record<string, unknown> {
  const fields: Record<string, unknown> = isPlainObject(entry) ? { ...entry } : { repo: entry }
  const next = writeRows(fields, changesOf(null, projectSettingValues(settings, fields), (group) => changed(group as keyof ProjectSettings)))
  const name = settings.branch.trim()
  if (changed('branch') && name === DEFAULT_BRANCH) delete next.branch
  else if (changed('branch')) next.branch = name
  return next
}
