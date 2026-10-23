import { DEFAULT_RULES, isActive, isTerminal, sameName, type ChainRules } from '../../../src/chain/rules.js'
import { MANUAL_LABELS, QUESTION_LABELS, runLabelOf, type StatusCategory, type TaskStatus } from '../../../src/tracker/model.js'

/**
 * The chain rules by what they are about (BTN-334): a status has one place, a label one rule. The values stay the lists
 * of the config, inherited key by key, each list whole: these helpers only read the lists into rows and back.
 */

/** A level of the settings that sets a rule key. */
export type RuleLevel = 'shared' | 'profile' | 'project'
/** Where a row's value comes from: a level, the status's category, or Even Keel itself. */
export type RuleOrigin = RuleLevel | 'category' | 'builtin'
export type StatusPlace = 'in' | 'out' | 'closed'
/** A status the rules may name; `category: null` — only a list names it, no tracker or task does. */
export interface KnownStatus {
  name: string
  category: StatusCategory | null
}
export interface StatusRow extends KnownStatus {
  place: StatusPlace
  origin: RuleOrigin
  /** The place it would have without the level's own lists: what its reset puts back. */
  inherited: StatusPlace
}
type StatusRules = Pick<ChainRules, 'active' | 'terminal'>
type LabelRules = Pick<ChainRules, 'requiredLabels' | 'excludedLabels'>
type MilestoneRules = Pick<ChainRules, 'requiredMilestones' | 'excludedMilestones'>

const TERMINAL_CATEGORIES: readonly StatusCategory[] = ['Won', 'Lost']
const ACTIVE_CATEGORIES: readonly StatusCategory[] = ['ToDo', 'Active']
const listed = (names: readonly string[], name: string) => names.some((each) => sameName(each, name))

/** Every status the trackers name, then those the tasks carry, then those only the lists name; a name once whatever its case. */
export function knownStatuses(vocabularies: readonly (readonly TaskStatus[])[], tasks: readonly TaskStatus[], rules: StatusRules): KnownStatus[] {
  const known: KnownStatus[] = []
  const add = (name: string, category: StatusCategory | null) => {
    if (name.trim() !== '' && !listed(known.map((each) => each.name), name)) known.push({ name: name.trim(), category })
  }
  for (const status of [...vocabularies.flat(), ...tasks]) add(status.name, status.category)
  for (const name of [...(rules.active ?? []), ...(rules.terminal ?? [])]) add(name, null)
  return known
}

// A status no tracker names is placed only by the lists: 'UnStarted' is no category any rule takes on its own.
const placeOf = (rules: StatusRules, status: KnownStatus): StatusPlace => {
  const task = { name: status.name, category: status.category ?? 'UnStarted' }
  const full = { ...rules, requiredLabels: [], excludedLabels: [], requiredMilestones: [], excludedMilestones: [] }
  return isTerminal(full, task) ? 'closed' : isActive(full, task) ? 'in' : 'out'
}

const closedByCategory = (status: KnownStatus) => status.category !== null && TERMINAL_CATEGORIES.includes(status.category)

function originOf(rules: StatusRules, status: KnownStatus, place: StatusPlace, origins: Record<keyof StatusRules, RuleLevel>): RuleOrigin {
  if (place === 'closed' || (rules.terminal !== null && closedByCategory(status))) return rules.terminal === null ? 'category' : origins.terminal
  return rules.active === null ? 'category' : origins.active
}

export function statusRows(known: readonly KnownStatus[], rules: StatusRules, inherited: StatusRules, origins: Record<keyof StatusRules, RuleLevel>): StatusRow[] {
  return known.map((status) => {
    const place = placeOf(rules, status)
    return { ...status, place, origin: originOf(rules, status, place, origins), inherited: placeOf(inherited, status) }
  })
}

/**
 * The lists the move of the status to `place` changes — only those it leaves or enters, so an inherited list it does not
 * touch stays inherited: `null` — by the categories, when every status sits where its category puts it. `explicit` — the
 * list spelled out instead, for a level that has no way to say "by the categories" over a list.
 */
export function withPlace(rows: readonly StatusRow[], name: string, place: StatusPlace, explicit = false): Partial<StatusRules> {
  const from = rows.find((row) => sameName(row.name, name))?.place
  const next = rows.map((row) => (sameName(row.name, name) ? { ...row, place } : row))
  const names = (wanted: StatusPlace) => next.filter((row) => row.place === wanted).map((row) => row.name)
  const touches = (each: StatusPlace) => from !== place && (from === each || place === each)
  const terminalByCategory = next.every((row) => row.place === 'closed' === closedByCategory(row))
  const activeByCategory = next.every((row) => (row.place === 'in') === (row.category !== null && ACTIVE_CATEGORIES.includes(row.category) && row.place !== 'closed'))
  return {
    ...(touches('in') && { active: activeByCategory && !explicit ? null : names('in') }),
    ...(touches('closed') && { terminal: terminalByCategory && !explicit ? null : names('closed') }),
  }
}

const sameList = (a: readonly string[] | null, b: readonly string[] | null) =>
  a === null || b === null ? a === b : a.length === b.length && a.every((name, at) => sameName(name, b[at]!))

/**
 * What a level stores for a key: `inherits` — the level may leave the key unset (a tracker profile), so a value equal to
 * what it would inherit is `undefined`, and "by the categories" over an inherited list is the list spelled out.
 */
export function settled(value: string[] | null, inherited: string[] | null, explicit: string[], inherits: boolean): string[] | null | undefined {
  if (!inherits) return value
  if (sameList(value, inherited)) return undefined
  return value ?? explicit
}

export type LabelRule = 'required' | 'excluded' | 'manual' | 'question' | 'run'
export interface LabelRow {
  name: string
  rule: LabelRule
  origin: RuleOrigin
}

/** Even Keel's own labels first, shown and not edited — the run labels only while they pick a model — then the lists'. */
export function labelRows(rules: LabelRules, origins: Record<keyof LabelRules, RuleLevel>, known: readonly string[], modelLabels: boolean): LabelRow[] {
  const builtin = (rule: LabelRule) => (name: string): LabelRow => ({ name, rule, origin: 'builtin' })
  const runs = modelLabels ? known.filter((name) => runLabelOf(name) !== null) : []
  return [
    ...MANUAL_LABELS.map(builtin('manual')),
    ...QUESTION_LABELS.map(builtin('question')),
    ...runs.map(builtin('run')),
    ...rules.requiredLabels.map((name): LabelRow => ({ name, rule: 'required', origin: origins.requiredLabels })),
    ...rules.excludedLabels.filter((name) => !listed(MANUAL_LABELS, name)).map((name): LabelRow => ({ name, rule: 'excluded', origin: origins.excludedLabels })),
  ]
}

/** The label lists with the label under `rule`, in neither list for `null`. */
export function withLabel(rules: LabelRules, name: string, rule: 'required' | 'excluded' | null): LabelRules {
  const without = (names: readonly string[]) => names.filter((each) => !sameName(each, name))
  const put = (names: readonly string[], wanted: 'required' | 'excluded') => {
    if (rule !== wanted) return without(names)
    return listed(names, name) ? [...names] : [...names, name.trim()]
  }
  return { requiredLabels: put(rules.requiredLabels, 'required'), excludedLabels: put(rules.excludedLabels, 'excluded') }
}

/** Which tasks of the tracker project are the project's: all, only some milestones', or all but some milestones'. */
export type MilestoneMode = 'all' | 'only' | 'except'

export const milestoneModeOf = (rules: MilestoneRules): MilestoneMode =>
  rules.requiredMilestones.length > 0 ? 'only' : rules.excludedMilestones.length > 0 ? 'except' : 'all'

/** The lists of `mode`: "only" keeps an excluded list too (a milestone it names among the required ones still stays out). */
export function withMilestoneMode(rules: MilestoneRules, mode: MilestoneMode): MilestoneRules {
  if (mode === 'all') return { requiredMilestones: [], excludedMilestones: [] }
  if (mode === 'except') return { requiredMilestones: [], excludedMilestones: [...rules.excludedMilestones] }
  return { requiredMilestones: [...rules.requiredMilestones], excludedMilestones: [...rules.excludedMilestones] }
}

/** Every key from one level: the shared settings', each key the level's own. */
export const originsAt = (level: RuleLevel): Record<keyof ChainRules, RuleLevel> =>
  Object.fromEntries(Object.keys(DEFAULT_RULES).map((key) => [key, level])) as Record<keyof ChainRules, RuleLevel>

/** The project's rules in force: its own keys, the profile's over the shared ones for the rest (`rulesWith` of the service). */
export function effectiveRules(rules: ChainRules, own: readonly (keyof ChainRules)[], profile: Partial<ChainRules>): ChainRules {
  const merged = { ...rules }
  for (const key of Object.keys(profile) as (keyof ChainRules)[]) {
    if (!own.includes(key) && profile[key] !== undefined) Object.assign(merged, { [key]: profile[key] })
  }
  return merged
}

/** Where a project's key comes from: its own while it differs from what it inherits — the service keeps no own value equal to it. */
export function ruleOrigins(rules: ChainRules, inherited: ChainRules, profile: Partial<ChainRules>): Record<keyof ChainRules, RuleLevel> {
  const keys = Object.keys(rules) as (keyof ChainRules)[]
  return Object.fromEntries(
    keys.map((key) => [key, !sameList(rules[key], inherited[key]) ? 'project' : profile[key] !== undefined ? 'profile' : 'shared']),
  ) as Record<keyof ChainRules, RuleLevel>
}
