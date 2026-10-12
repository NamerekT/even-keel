import { DEFAULT_RULES, type ChainRules } from './chain/rules.js'
import {
  DEFAULT_COMPARE,
  DEFAULT_CONTEXT,
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL,
  isPlainObject,
  parseConfig,
  parseShared,
  RULE_KEYS,
  withProjectSettings,
  type EvenKeelConfig,
} from './config.js'
import { fail } from './notice/notice.js'
import type { ConfigView, ProjectForm, SharedForm, TrackerChoice } from './state.js'
import { DEFAULT_HIDDEN_SKILLS } from './tools/settings.js'
import { ADAPTERS, DEFAULT_TRACKER } from './tracker/adapters.js'
import type { TrackerAdapter } from './tracker/source.js'

type Adapters = Readonly<Record<string, Pick<TrackerAdapter, 'projectKey'>>>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const names = (list: string[]) => list.map((name) => name.trim()).filter((name) => name !== '')

/** The forms of the settings: what the config ends up with, per project and shared. */
export function formsOf(config: EvenKeelConfig, adapters: Adapters = ADAPTERS): Pick<ConfigView, 'shared' | 'projects'> {
  const projects = Object.fromEntries(
    Object.entries(config.projects).map(([key, repo]): [string, ProjectForm] => [
      key,
      {
        ...config.settings[key]!,
        repo,
        tracker: config.trackers[key]!,
        trackerProject: adapters[config.trackers[key]!]?.projectKey === undefined ? null : (config.trackerProjects[key] ?? null),
        slot: config.slots[key] ?? 0,
        brief: config.briefs[key]!,
        chain: config.rules[key]!,
      },
    ]),
  )
  const { parallel, tracker, brief, chain, model, modelPrompts, language, promptLanguage, hiddenSkills, allowedHosts, context, stats } = config
  return { projects, shared: { parallel, tracker, brief, chain, model, modelPrompts, language, promptLanguage, hiddenSkills, allowedHosts, context, stats } }
}

export function trackerChoices(adapters: Adapters = ADAPTERS): TrackerChoice[] {
  return Object.entries(adapters).map(([name, { projectKey }]) => ({
    name,
    projectKey: projectKey === undefined ? null : { key: projectKey.key, example: projectKey.example, optional: projectKey.optional === true },
  }))
}

/** What is saved in the file but not applied until the service restarts. */
export function restartPending(current: EvenKeelConfig, saved: EvenKeelConfig): string[] {
  const pending: string[] = []
  if (current.tracker !== saved.tracker) pending.push('tracker')
  if (!same(current.context, saved.context)) pending.push('context')
  for (const key of Object.keys(saved.projects)) {
    if (!Object.hasOwn(current.projects, key)) {
      pending.push(key)
      continue
    }
    if (current.projects[key] !== saved.projects[key]) pending.push(`${key}.repo`)
    if (current.slots[key] !== saved.slots[key]) pending.push(`${key}.slot`)
    if (current.trackers[key] !== saved.trackers[key]) pending.push(`${key}.tracker`)
    if (current.trackerProjects[key] !== saved.trackerProjects[key]) pending.push(`${key}.trackerProject`)
  }
  return pending
}

/**
 * The raw config with the project's entry set from the form. A value the form leaves as it was keeps its key as written;
 * a changed one is written only where it differs from what the project would inherit, otherwise its key goes.
 */
export function withProjectForm(raw: unknown, project: string, form: ProjectForm, adapters: Adapters = ADAPTERS): Record<string, unknown> {
  const config = isPlainObject(raw) ? raw : {}
  const { projects } = config
  if (!isPlainObject(projects) || !Object.hasOwn(projects, project)) throw fail('config.unknownProject', { key: project })
  const before = formsOrNull(config, adapters)?.projects[project]
  const changed = (field: keyof ProjectForm) => before === undefined || !same(before[field], form[field])
  const shared = parseShared(config, adapters)
  const entry = withProjectSettings(projects[project], form)

  if (changed('repo')) entry.repo = form.repo.trim()
  if (changed('slot')) {
    if (form.slot === 0) delete entry.slot
    else entry.slot = form.slot
  }
  if (changed('tracker')) inherit(entry, 'tracker', form.tracker, shared.tracker)
  if (changed('brief')) inherit(entry, 'brief', form.brief, shared.brief)
  if (changed('chain')) {
    const rules = withRules(entry.chain, rulesOf(form.chain), shared.chain, before?.chain)
    if (rules === undefined) delete entry.chain
    else entry.chain = rules
  }
  if (changed('tracker') || changed('trackerProject')) {
    const own = adapters[form.tracker]?.projectKey?.key
    for (const { projectKey } of Object.values(adapters)) {
      if (projectKey !== undefined && projectKey.key !== own) delete entry[projectKey.key]
    }
    const value = form.trackerProject?.trim() ?? ''
    if (own !== undefined && value === '') delete entry[own]
    else if (own !== undefined) entry[own] = value
  }
  return { ...config, projects: { ...projects, [project]: entry } }
}

/** The raw config with the shared keys set from the form, by the same rule as `withProjectForm`, against the defaults. */
export function withSharedForm(raw: unknown, form: SharedForm, adapters: Adapters = ADAPTERS): Record<string, unknown> {
  const config: Record<string, unknown> = { ...(isPlainObject(raw) ? raw : {}) }
  const before = formsOrNull(config, adapters)?.shared
  const changed = (field: keyof SharedForm) => before === undefined || !same(before[field], form[field])
  const put = (key: string, value: unknown, fallback: unknown) => {
    if (same(value, fallback)) delete config[key]
    else config[key] = value
  }

  if (changed('parallel')) put('parallel', form.parallel, 1)
  if (changed('tracker')) put('tracker', form.tracker, DEFAULT_TRACKER)
  if (changed('brief')) put('brief', form.brief, true)
  if (changed('chain')) put('chain', withRules(config.chain, rulesOf(form.chain), DEFAULT_RULES, before?.chain), undefined)
  if (changed('model')) put('model', form.model, DEFAULT_MODEL)
  if (changed('modelPrompts')) {
    const prompts = Object.entries(form.modelPrompts).flatMap(([model, text]) => (text?.trim() ? [[model, text.trim()]] : []))
    put('modelPrompts', Object.fromEntries(prompts), {})
  }
  if (changed('language')) put('language', form.language, null)
  if (changed('language') || changed('promptLanguage')) put('promptLanguage', form.promptLanguage, form.language ?? DEFAULT_LANGUAGE)
  if (changed('hiddenSkills')) put('hiddenSkills', names(form.hiddenSkills), DEFAULT_HIDDEN_SKILLS)
  if (changed('allowedHosts')) put('allowedHosts', names(form.allowedHosts).map((name) => name.toLowerCase()), [])
  if (changed('context')) put('context', withDefaults(config.context, form.context, DEFAULT_CONTEXT), undefined)
  if (changed('stats')) {
    const { compare, moves, otherBelow, checkpointTokens } = form.stats
    const stats = withDefaults(config.stats, { moves, otherBelow, checkpointTokens }, { moves: {}, otherBelow: 0, checkpointTokens: null }) ?? {}
    const written = withDefaults(stats.compare, compare, DEFAULT_COMPARE)
    if (written === undefined) delete stats.compare
    else stats.compare = written
    put('stats', Object.keys(stats).length === 0 ? undefined : stats, undefined)
  }
  return config
}

function formsOrNull(config: Record<string, unknown>, adapters: Adapters): ReturnType<typeof formsOf> | null {
  try {
    return formsOf(parseConfig(config, adapters), adapters)
  } catch {
    return null
  }
}

function inherit(entry: Record<string, unknown>, key: string, value: unknown, inherited: unknown): void {
  if (same(value, inherited)) delete entry[key]
  else entry[key] = value
}

/** Names trimmed, blanks dropped; an empty `active` or `terminal` goes by the categories of the statuses. */
function rulesOf(rules: ChainRules): ChainRules {
  const statuses = (list: string[] | null) => (list === null || names(list).length === 0 ? null : names(list))
  return { active: statuses(rules.active), terminal: statuses(rules.terminal), requiredLabels: names(rules.requiredLabels), excludedLabels: names(rules.excludedLabels) }
}

/** The `chain` object with the rules that differ from the inherited ones; `undefined` when none do. Rules left as they were stay as written. */
function withRules(written: unknown, rules: ChainRules, inherited: ChainRules, before: ChainRules | undefined): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = isPlainObject(written) ? { ...written } : {}
  for (const key of RULE_KEYS) {
    if (before !== undefined && same(before[key], rules[key])) continue
    if (same(rules[key], inherited[key])) delete next[key]
    else next[key] = rules[key]
  }
  return Object.keys(next).length === 0 ? undefined : next
}

/** The object with each key of `defaults` set to the value, or removed where it is the default; other keys stay. `undefined` when it ends up empty. */
function withDefaults<T extends object>(written: unknown, values: T, defaults: Readonly<T>): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = isPlainObject(written) ? { ...written } : {}
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    if (same(values[key], defaults[key])) delete next[key]
    else next[key] = values[key]
  }
  return Object.keys(next).length === 0 ? undefined : next
}
