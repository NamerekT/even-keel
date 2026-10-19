import type { ChainRules } from './chain/rules.js'
import { DEFAULT_BRANCH, DEFAULT_LANGUAGE, isPlainObject, parseConfig, RULE_KEYS, withProjectSettings, type EvenKeelConfig } from './config.js'
import { fail } from './notice/notice.js'
import { changesOf, type FormValue } from './settings/changes.js'
import { sharedRows, withRows, writeRows } from './settings/file.js'
import { defaultOf } from './settings/registry.js'
import { checkRows, resolve, type Values } from './settings/resolve.js'
import type { ConfigView, ProjectDraft, ProjectForm, SharedForm, TrackerChoice } from './state.js'
import type { TallyMode } from './stats/mode.js'
import { ADAPTERS } from './tracker/adapters.js'
import type { TrackerAdapter } from './tracker/source.js'
import type { UpdateSettings } from './updates/release.js'

type Adapters = Readonly<Record<string, Pick<TrackerAdapter, 'projectKey'>>>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const names = (list: string[]) => list.map((name) => name.trim()).filter((name) => name !== '')
/** A value of the form written against the setting's default. */
const value = (group: string, key: string, own: unknown, qualifier = ''): FormValue => ({ group, key, qualifier, value: own, fallback: defaultOf(key, qualifier) })

/** Even Keel's own values of the raw config, defaults filled in: what a project inherits. */
function sharedValues(raw: unknown, adapters: Adapters): Values {
  return resolve([], checkRows(sharedRows(raw), [], { trackers: Object.keys(adapters) })).shared
}

/** The forms of the settings: what the config ends up with, per project and shared. */
export function formsOf(config: EvenKeelConfig, adapters: Adapters = ADAPTERS): Pick<ConfigView, 'shared' | 'projects'> {
  const projects = Object.fromEntries(
    Object.entries(config.projects).map(([key, repo]): [string, ProjectForm] => [
      key,
      {
        ...config.settings[key]!,
        name: config.names[key] ?? null,
        repo,
        tracker: config.trackers[key]!,
        trackerProject: adapters[config.trackers[key]!]?.projectKey === undefined ? null : (config.trackerProjects[key] ?? null),
        slot: config.slots[key] ?? 0,
        color: config.colors[key] ?? null,
        brief: config.briefs[key]!,
        chain: config.rules[key]!,
      },
    ]),
  )
  const { parallel, tracker, brief, chain, provider, models, accounts, execution, cli, modelLabels, modelPrompts, language, promptLanguage, hiddenSkills, cacheTtl, allowedHosts, context, stats } = config
  const updates = { check: config.updates.check, notify: config.updates.notify }
  const shared = {
    ...{ parallel, tracker, brief, chain, provider, models, accounts, execution, cli, modelLabels, modelPrompts },
    ...{ language, promptLanguage, hiddenSkills, cacheTtl, allowedHosts, context, stats, updates },
  }
  return { projects, shared }
}

export function trackerChoices(adapters: Readonly<Record<string, Pick<TrackerAdapter, 'title' | 'projectKey'>>> = ADAPTERS): TrackerChoice[] {
  return Object.entries(adapters).map(([name, { title, projectKey }]) => ({
    name,
    title,
    projectKey: projectKey === undefined ? null : { key: projectKey.key, example: projectKey.example, optional: projectKey.optional === true },
  }))
}

/**
 * The raw config with the project's entry set from the form. `base` is what the form started from: a value the form left
 * as it was keeps its key as written, even if the file changed since; a changed one is written only where it differs
 * from what the project would inherit, otherwise its key goes.
 */
export function withProjectForm(raw: unknown, id: string, form: ProjectForm, base: ProjectForm, adapters: Adapters = ADAPTERS): Record<string, unknown> {
  const config = isPlainObject(raw) ? raw : {}
  const { projects } = config
  const index = Array.isArray(projects) ? projects.findIndex((each: unknown) => isPlainObject(each) && each.id === id) : -1
  if (index < 0) throw fail('config.unknownProject', { key: id })
  const list = projects as unknown[]
  const changed = (field: keyof ProjectForm) => !same(base[field], form[field])
  const shared = sharedValues(config, adapters)
  const rules = rulesOf(form.chain)
  const inherited = (key: string, own: unknown): FormValue => ({ group: key, key, qualifier: '', value: own, fallback: shared[key] })
  const values = [
    inherited('tracker', form.tracker),
    inherited('brief', form.brief),
    ...RULE_KEYS.map((rule) => inherited(`chain.${rule}`, rules[rule])),
    { group: 'slot', key: 'slot', qualifier: '', value: form.slot === 0 ? undefined : form.slot },
    { group: 'color', key: 'color', qualifier: '', value: form.color ?? undefined },
  ]
  const rule = (group: string) => group.slice('chain.'.length) as keyof ChainRules
  const changedGroup = (group: string) => (group.startsWith('chain.') ? !same(base.chain[rule(group)], rules[rule(group)]) : changed(group as keyof ProjectForm))
  const entry = writeRows(withProjectSettings(list[index], form, changed), changesOf(id, values, changedGroup))

  if (changed('repo')) entry.repo = form.repo.trim()
  if (changed('name')) {
    const name = form.name?.trim() ?? ''
    if (name === '') delete entry.name
    else entry.name = name
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
  return { ...config, projects: list.map((each, at) => (at === index ? entry : each)) }
}

/** The raw config with an entry for the wizard's draft appended: the record and only what differs from what the project would inherit. */
export function withNewProject(raw: unknown, draft: ProjectDraft, id: string, adapters: Adapters = ADAPTERS): Record<string, unknown> {
  const config = isPlainObject(raw) ? raw : {}
  const shared = sharedValues(config, adapters)
  const entry: Record<string, unknown> = { id, key: draft.key.trim(), repo: draft.repo.trim() }
  const name = draft.name.trim()
  if (name !== '') entry.name = name
  const branch = draft.branch.trim()
  if (branch !== '' && branch !== DEFAULT_BRANCH) entry.branch = branch
  if (draft.tracker !== shared.tracker) entry.tracker = draft.tracker
  const own = adapters[draft.tracker]?.projectKey?.key
  if (own !== undefined && draft.trackerProject.trim() !== '') entry[own] = draft.trackerProject.trim()
  if (draft.slot > 0) entry.slot = draft.slot
  const next = { ...config, projects: [...(Array.isArray(config.projects) ? config.projects : []), entry] }
  // Written, so that the color stays when a project before it goes and frees a lower one.
  const color = parseConfig(next, adapters).colors[entry.key as string]
  if (color !== undefined) entry.color = color
  return next
}

/** The raw config without the entry of the project with the id; the rest stays as written. */
export function withoutProject(raw: unknown, id: string): Record<string, unknown> {
  const config = isPlainObject(raw) ? raw : {}
  const projects = Array.isArray(config.projects) ? (config.projects as unknown[]) : []
  const kept = projects.filter((entry) => !(isPlainObject(entry) && entry.id === id))
  if (kept.length === projects.length) throw fail('config.unknownProject', { key: id })
  return { ...config, projects: kept }
}

/** The raw config with the shared keys set from the form, by the same rule as `withProjectForm`, against the defaults. */
export function withSharedForm(raw: unknown, form: SharedForm, base: SharedForm): Record<string, unknown> {
  const changed = (field: keyof SharedForm) => !same(base[field], form[field])
  const rules = rulesOf(form.chain)
  const byProvider = ['models', 'accounts', 'execution', 'cli'] as const
  const trimmed = (names: Record<string, string>, provider: string) => names[provider]?.trim() ?? ''
  const prompts = Object.entries(form.modelPrompts).flatMap(([model, text]) => (text?.trim() ? [[model, text.trim()]] : []))
  const values: FormValue[] = [
    value('parallel', 'parallel', form.parallel),
    value('tracker', 'tracker', form.tracker),
    value('brief', 'brief', form.brief),
    ...RULE_KEYS.map((rule) => value(`chain.${rule}`, `chain.${rule}`, rules[rule])),
    value('provider', 'provider', form.provider),
    ...byProvider.flatMap((field) =>
      [...new Set([...Object.keys(form[field]), ...Object.keys(base[field])])].map((provider) =>
        value(`${field}.${provider}`, field, trimmed(form[field], provider) || undefined, provider),
      ),
    ),
    value('modelLabels', 'modelLabels', form.modelLabels),
    value('modelPrompts', 'modelPrompts', Object.fromEntries(prompts)),
    value('language', 'language', form.language),
    { group: 'promptLanguage', key: 'promptLanguage', qualifier: '', value: form.promptLanguage, fallback: form.language ?? DEFAULT_LANGUAGE },
    value('hiddenSkills', 'hiddenSkills', names(form.hiddenSkills)),
    value('cacheTtl', 'cacheTtl', form.cacheTtl),
    value('allowedHosts', 'allowedHosts', names(form.allowedHosts).map((name) => name.toLowerCase())),
    ...(['window', 'warn', 'danger'] as const).map((key) => value('context', `context.${key}`, form.context[key])),
    ...(['minTasks', 'minSessions', 'days'] as const).map((key) => value('stats', `stats.compare.${key}`, form.stats.compare[key])),
    value('stats', 'stats.moves', form.stats.moves),
    value('stats', 'stats.otherBelow', form.stats.otherBelow),
    value('stats', 'stats.checkpointTokens', form.stats.checkpointTokens),
    value('updates', 'updates.check', form.updates.check),
    value('updates', 'updates.notify', form.updates.notify),
  ]
  const changedGroup = (group: string) => {
    const [field, part] = group.split('.') as [keyof SharedForm, string | undefined]
    if (field === 'promptLanguage') return changed('language') || changed('promptLanguage')
    if (part === undefined) return changed(field)
    if (field === 'chain') return !same(base.chain[part as keyof ChainRules], rules[part as keyof ChainRules])
    return trimmed(form[field] as Record<string, string>, part) !== trimmed(base[field] as Record<string, string>, part)
  }
  return withRows(raw, changesOf(null, values, changedGroup))
}

/** The raw config with the given keys of `updates` set, against the defaults: what the toast's buttons write. */
export function withUpdates(raw: unknown, patch: Partial<Pick<UpdateSettings, 'check' | 'notify'>>): Record<string, unknown> {
  const values = Object.entries(patch).map(([key, setting]) => value('updates', `updates.${key}`, setting))
  return withRows(raw, changesOf(null, values, () => true))
}

/** The raw config with the chain's switches set, against the defaults: what the "Unattended" and "Trim the tools" switches write. */
export function withChainSwitches(raw: unknown, patch: Partial<Pick<EvenKeelConfig, 'unattended' | 'trimTools'>>): Record<string, unknown> {
  const values = Object.entries(patch).map(([key, setting]) => value(key, key, setting))
  return withRows(raw, changesOf(null, values, () => true))
}

/** The raw config with Tally's place set: what the page's stats setup and settings write. */
export function withTally(raw: unknown, mode: TallyMode): Record<string, unknown> {
  return withRows(raw, changesOf(null, [value('tally', 'tally', mode)], () => true))
}

/**
 * The raw config with the shared provider moved to `provider` and its shared account set: what moving the Even Keel
 * role writes. Projects with their own provider or account keep them.
 */
export function withRunAccount(raw: unknown, provider: string, key: string): Record<string, unknown> {
  const values = [value('provider', 'provider', provider), value('accounts', 'accounts', key.trim() || undefined, provider)]
  return withRows(raw, changesOf(null, values, () => true))
}

/** The raw config with only the shared pool's entry of `provider` set: the first account added while it names no folder. */
export function withSharedAccount(raw: unknown, provider: string, key: string): Record<string, unknown> {
  return withRows(raw, changesOf(null, [value('accounts', 'accounts', key.trim() || undefined, provider)], () => true))
}

/** Names trimmed, blanks dropped; an empty `active` or `terminal` goes by the categories of the statuses. */
function rulesOf(rules: ChainRules): ChainRules {
  const statuses = (list: string[] | null) => (list === null || names(list).length === 0 ? null : names(list))
  return { active: statuses(rules.active), terminal: statuses(rules.terminal), requiredLabels: names(rules.requiredLabels), excludedLabels: names(rules.excludedLabels) }
}
