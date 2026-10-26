import { fail, type NoticeCode } from './notice/notice.js'
import { DEFAULT_CHANGELOG } from './changelog/file.js'
import { DEFAULT_CI } from './settings/defaults.js'
import { OWN_KEYS } from './settings/registry.js'
import type { AnswerRequest } from './server.js'
import type { Language } from './language.js'
import type { CacheTtl, CheckpointShares, CiSettings, ContextScale, FeedDraft, OwnValues, ProjectDraft, ProjectForm, SharedForm, Standard, StatsConfig } from './state.js'
import type { ChainRules } from './chain/rules.js'
import { CI_KINDS, type CiKind } from './ci/model.js'
import { DEFAULT_SHARES } from './stats/checkpoint.js'
import type { CompareSettings } from './stats/rules.js'
import type { TallyServerDraft } from './stats/connect.js'
import { isTallyMode, type TallyMode } from './stats/mode.js'
import { PROFILE_RULE_KEYS, type ProfileRules } from './profiles/model.js'
import type { Protection } from './sessions/protection.js'

export function projectOf(body: Record<string, unknown>): string {
  if (typeof body.project !== 'string' || body.project === '') throw fail('request.required', { field: 'project' })
  return body.project
}

/** What a chain command was aimed at, for the service log: `project/task`, the order, or the switch. */
export function commandTarget(body: Record<string, unknown>): string {
  const parts = [body.project, body.task].filter((part) => typeof part === 'string' && part !== '')
  if (Array.isArray(body.order)) parts.push(body.order.join(','))
  if (typeof body.on === 'boolean') parts.push(body.on ? 'on' : 'off')
  return parts.join('/')
}

export function flagOf(body: Record<string, unknown>): boolean {
  if (typeof body.on !== 'boolean') throw fail('request.required', { field: 'on' })
  return body.on
}

export function taskOf(body: Record<string, unknown>): string {
  if (typeof body.task !== 'string' || body.task === '') throw fail('request.required', { field: 'task' })
  return body.task
}

export function answerOf(body: Record<string, unknown>): AnswerRequest {
  const { sessionId, ask, answers, text, files } = body
  if (typeof sessionId !== 'string' || sessionId === '') throw fail('request.required', { field: 'sessionId' })
  if (ask !== null && (typeof ask !== 'string' || ask === '')) throw fail('request.required', { field: 'ask' })
  const answered = typeof answers === 'object' && answers !== null && !Array.isArray(answers) ? Object.entries(answers) : []
  const sent = Array.isArray(files) ? files : []
  if (!answered.every(([, value]) => typeof value === 'string')) throw fail('request.required', { field: 'answers' })
  if (!sent.every((file) => typeof file?.name === 'string' && typeof file?.data === 'string')) throw fail('request.required', { field: 'files' })
  return {
    project: projectOf(body),
    task: taskOf(body),
    sessionId,
    ask,
    answers: Object.fromEntries(answered) as Record<string, string>,
    text: typeof text === 'string' ? text : '',
    files: sent.map((file: { name: string; data: string }) => ({ name: file.name, data: Buffer.from(file.data, 'base64') })),
  }
}

/** The values a settings form started from: only a field that differs from them is written over the file. */
export function baseOf(body: Record<string, unknown>): Record<string, unknown> {
  return mapOf(body.base, 'base', () => true)
}

// The shape only: the values are judged by `parseConfig` when the form is written into the config.
export function draftOf(body: Record<string, unknown>): ProjectDraft {
  const { slot } = body
  if (!Number.isInteger(slot) || (slot as number) < 0) throw fail('request.required', { field: 'slot' })
  const text = (field: keyof ProjectDraft) => textOf(body[field], field)
  const profile = body.profile === undefined || body.profile === null ? null : text('profile')
  // A page open since before the milestones field sends none.
  const milestones = body.milestones ?? []
  if (!Array.isArray(milestones) || milestones.some((name) => typeof name !== 'string')) throw fail('request.required', { field: 'milestones' })
  const fields = { repo: text('repo'), branch: text('branch'), key: text('key'), name: text('name'), tracker: text('tracker'), trackerProject: text('trackerProject') }
  // A page open since before the agent field sends none: the shared provider.
  const provider = body.provider === undefined || body.provider === null ? null : text('provider')
  return { ...fields, profile, slot: slot as number, milestones: milestones as string[], provider }
}

export function feedDraftOf(body: Record<string, unknown>): FeedDraft {
  const optional = (field: 'place' | 'profile') => (body[field] === undefined || body[field] === null ? null : textOf(body[field], field))
  return { tracker: textOf(body.tracker, 'tracker'), key: textOf(body.key, 'key'), place: optional('place'), profile: optional('profile') }
}

export function projectFormOf(body: Record<string, unknown>): ProjectForm {
  const { name, prompt, beforeStart, check, afterGreen, ci, remoteProfiles, pullRequests, intakeLabel, mergeInto, carryAgent, fillMilestone, changelog, standards, provider, models, accounts, modelLabels, branch, repo, tracker, trackerProject, slot, color, brief, chain } = body
  if (name !== undefined && name !== null && typeof name !== 'string') throw fail('request.required', { field: 'name' })
  if (prompt !== null && typeof prompt !== 'string') throw fail('request.required', { field: 'prompt' })
  const settings = {
    prompt,
    beforeStart: linesOf(beforeStart, 'beforeStart'),
    check: linesOf(check, 'check'),
    afterGreen: linesOf(afterGreen, 'afterGreen'),
    ci: ciOf(ci),
    remoteProfiles: mapOf<string>(remoteProfiles ?? {}, 'remoteProfiles', (value) => typeof value === 'string'),
  }
  if (typeof pullRequests !== 'boolean') throw fail('request.required', { field: 'pullRequests' })
  if (typeof fillMilestone !== 'boolean') throw fail('request.required', { field: 'fillMilestone' })
  // A page open since before release projects sends none.
  if (mergeInto !== undefined && mergeInto !== null && typeof mergeInto !== 'string') throw fail('request.required', { field: 'mergeInto' })
  // And one open since before the carry by itself (BTN-370).
  if (carryAgent !== undefined && typeof carryAgent !== 'boolean') throw fail('request.required', { field: 'carryAgent' })
  // So does one open since before the intake (BTN-262).
  if (intakeLabel !== undefined && intakeLabel !== null && typeof intakeLabel !== 'string') throw fail('request.required', { field: 'intakeLabel' })
  if (typeof changelog !== 'string') throw fail('request.required', { field: 'changelog' })
  // A page open since before the standards (BTN-359) sends none; the setting's own check judges the entries.
  if (standards !== undefined && !Array.isArray(standards)) throw fail('request.required', { field: 'standards' })
  if (provider !== null && typeof provider !== 'string') throw fail('request.required', { field: 'provider' })
  if (modelLabels !== null && typeof modelLabels !== 'boolean') throw fail('request.required', { field: 'modelLabels' })
  if (trackerProject !== null && typeof trackerProject !== 'string') throw fail('request.required', { field: 'trackerProject' })
  if (!Number.isInteger(slot) || (slot as number) < 0) throw fail('request.required', { field: 'slot' })
  if (color !== null && !Number.isInteger(color)) throw fail('request.required', { field: 'color' })
  return {
    ...settings,
    name: name ?? null,
    pullRequests,
    intakeLabel: intakeLabel?.trim() || null,
    mergeInto: mergeInto?.trim() || null,
    carryAgent: carryAgent ?? false,
    fillMilestone,
    changelog: changelog.trim() === '' ? DEFAULT_CHANGELOG : changelog,
    standards: (standards ?? []) as Standard[],
    provider,
    models: mapOf(models, 'models', (value) => typeof value === 'string'),
    accounts: mapOf(accounts, 'accounts', (value) => typeof value === 'string'),
    modelLabels,
    branch: textOf(branch, 'branch'),
    repo: textOf(repo, 'repo'),
    tracker: textOf(tracker, 'tracker'),
    trackerProject,
    slot: slot as number,
    color: color as number | null,
    brief: briefOf(brief),
    chain: rulesOf(chain),
    // The page's reading of `chain`, never written: the writer compares each key with what the project inherits.
    ownRules: [],
    // What the project ends up with: shown by the panel, never written; `own` is what is.
    promptLanguage: body.promptLanguage as Language,
    cacheTtl: (body.cacheTtl ?? null) as CacheTtl | null,
    contextHandoffs: (body.contextHandoffs ?? true) as boolean,
    checkpointTokens: (body.checkpointTokens ?? null) as number | null,
    checkpointShares: sharesOf(body.checkpointShares),
    own: ownOf(body.own),
  }
}

/** A page from before the own values sends none: form and base then agree and nothing is written. */
export function ownOf(raw: unknown): OwnValues {
  const own = mapOf<unknown>(raw ?? {}, 'own', () => true)
  if (Object.keys(own).some((key) => !(OWN_KEYS as readonly string[]).includes(key))) throw fail('request.required', { field: 'own' })
  return own as OwnValues
}

export function sharedFormOf(body: Record<string, unknown>): SharedForm {
  const { parallel, brief, chain, provider, models, accounts, execution, cli, modelLabels, modelPrompts, prompt, language, promptLanguage, hiddenSkills, cacheTtl, contextHandoffs, keepWarm, ci, fillMilestone, allowedHosts, context, stats, updates } = body
  if (language !== null && typeof language !== 'string') throw fail('request.required', { field: 'language' })
  if (prompt != null && typeof prompt !== 'string') throw fail('request.required', { field: 'prompt' })
  if (cacheTtl != null && typeof cacheTtl !== 'string') throw fail('request.required', { field: 'cacheTtl' })
  return {
    protection: body.protection as Protection | undefined,
    parallel: numberOf(parallel, 'parallel'),
    brief: briefOf(brief),
    chain: rulesOf(chain),
    provider: textOf(provider, 'provider'),
    models: mapOf(models, 'models', (value) => typeof value === 'string'),
    accounts: mapOf(accounts, 'accounts', (value) => typeof value === 'string'),
    execution: mapOf(execution, 'execution', (value) => typeof value === 'string'),
    cli: mapOf(cli, 'cli', (value) => typeof value === 'string'),
    modelLabels: switchOf(modelLabels, 'modelLabels'),
    modelPrompts: mapOf(modelPrompts, 'modelPrompts', (value) => typeof value === 'string'),
    // A page from before the shared prompt sends none: form and base then agree and nothing is written.
    prompt: (prompt ?? null) as string | null,
    language: language as Language | null,
    promptLanguage: textOf(promptLanguage, 'promptLanguage') as Language,
    hiddenSkills: linesOf(hiddenSkills, 'hiddenSkills'),
    // A page from before the switch sends none: form and base then agree and nothing is written.
    cacheTtl: (cacheTtl ?? null) as CacheTtl | null,
    // A page from before the switch sends none: on, as the default, so nothing is written.
    contextHandoffs: contextHandoffs === undefined ? true : switchOf(contextHandoffs, 'contextHandoffs'),
    // A page from before the setting sends none: off, as the default, so nothing is written.
    keepWarm: keepWarm === undefined ? 0 : numberOf(keepWarm, 'keepWarm'),
    ci: ci === undefined ? DEFAULT_CI : ciOf(ci),
    fillMilestone: fillMilestone === undefined ? false : switchOf(fillMilestone, 'fillMilestone'),
    allowedHosts: linesOf(allowedHosts, 'allowedHosts'),
    context: mapOf(context, 'context', (value) => typeof value === 'number') as unknown as ContextScale,
    stats: statsOf(stats),
    updates: updatesOf(updates),
  }
}

/** A page from before the update switches sends none: form and base then agree and nothing is written. */
export function updatesOf(raw: unknown): SharedForm['updates'] {
  if (raw === undefined) return { check: true, notify: true }
  const { check, notify } = mapOf(raw, 'updates', (value) => typeof value === 'boolean')
  return { check: switchOf(check, 'updates'), notify: switchOf(notify, 'updates') }
}

export function statsOf(raw: unknown): StatsConfig {
  const { compare, moves, otherBelow, checkpointTokens, checkpointShares } = mapOf(raw, 'stats', () => true)
  if (checkpointTokens !== null && typeof checkpointTokens !== 'number') throw fail('request.required', { field: 'stats' })
  return {
    compare: mapOf(compare, 'stats', (value) => typeof value === 'number') as unknown as CompareSettings,
    moves: mapOf(moves, 'stats', (value) => typeof value === 'string'),
    otherBelow: numberOf(otherBelow, 'stats'),
    checkpointTokens,
    checkpointShares: sharesOf(checkpointShares),
  }
}

/** A page from before the shares sends none: form and base then agree and nothing is written. */
export function sharesOf(raw: unknown): CheckpointShares {
  if (raw === undefined) return DEFAULT_SHARES
  const { first, late, hard } = mapOf(raw, 'stats', (value) => typeof value === 'number')
  return { first: numberOf(first, 'stats'), late: numberOf(late, 'stats'), hard: numberOf(hard, 'stats') }
}

export function rulesOf(raw: unknown): ChainRules {
  const { active, terminal, requiredLabels, excludedLabels, requiredMilestones, excludedMilestones } = mapOf(raw, 'chain', () => true)
  const statuses = (list: unknown) => (list === null ? null : linesOf(list, 'chain'))
  return {
    active: statuses(active),
    terminal: statuses(terminal),
    requiredLabels: linesOf(requiredLabels, 'chain'),
    excludedLabels: linesOf(excludedLabels, 'chain'),
    requiredMilestones: linesOf(requiredMilestones ?? [], 'chain'),
    excludedMilestones: linesOf(excludedMilestones ?? [], 'chain'),
  }
}

/** A profile's rules: only the keys sent, a status list may be `null` (by the status category). */
export function profileRulesOf(raw: unknown): ProfileRules {
  const sent = mapOf(raw, 'rules', () => true)
  const rules: ProfileRules = {}
  for (const key of PROFILE_RULE_KEYS) {
    const value = sent[key]
    if (value === undefined) continue
    Object.assign(rules, { [key]: value === null && (key === 'active' || key === 'terminal') ? null : linesOf(value, 'rules') })
  }
  return rules
}

export function linesOf(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw) || !raw.every((line) => typeof line === 'string')) throw fail('request.required', { field })
  return raw
}

export function textOf(raw: unknown, field: string): string {
  if (typeof raw !== 'string') throw fail('request.required', { field })
  return raw
}

export function numberOf(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw fail('request.required', { field })
  return raw
}

export function switchOf(raw: unknown, field: string): boolean {
  if (typeof raw !== 'boolean') throw fail('request.required', { field })
  return raw
}

export function briefOf(raw: unknown): boolean | null {
  return raw === null ? null : switchOf(raw, 'brief')
}

export function mapOf<T>(raw: unknown, field: string, fits: (value: unknown) => boolean): Record<string, T> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Object.values(raw).every(fits)) throw fail('request.required', { field })
  return raw as Record<string, T>
}

export function ciOf(raw: unknown): CiSettings {
  const { guard, kinds, waitMinutes, recheckMain, fixTask } = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const known = Array.isArray(kinds) && kinds.every((kind) => (CI_KINDS as readonly unknown[]).includes(kind))
  const wait = waitMinutes === null || (Number.isInteger(waitMinutes) && (waitMinutes as number) >= 0)
  if (typeof guard !== 'boolean' || !known || !wait || typeof recheckMain !== 'boolean' || typeof fixTask !== 'boolean') throw fail('request.required', { field: 'ci' })
  return { guard, kinds: kinds as CiKind[], waitMinutes: waitMinutes as number | null, recheckMain, fixTask }
}

export function accountOf(body: Record<string, unknown>): string {
  if (typeof body.account !== 'string' || body.account === '') throw fail('request.required', { field: 'account' })
  return body.account
}

export function appOf(body: Record<string, unknown>): string {
  if (typeof body.app !== 'string' || body.app === '') throw fail('request.required', { field: 'app' })
  return body.app
}

export function nameOf(body: Record<string, unknown>): string {
  if (typeof body.name !== 'string' || body.name === '') throw fail('request.required', { field: 'name' })
  return body.name
}

export function secretValuesOf(raw: unknown): Record<string, string | null> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('request.required', { field: 'values' })
  for (const [name, value] of Object.entries(raw)) if (value !== null && typeof value !== 'string') throw fail('request.required', { field: name })
  return raw as Record<string, string | null>
}

export function optionalProjectOf(body: Record<string, unknown>): string | undefined {
  return body.project === undefined || body.project === null ? undefined : projectOf(body)
}

export function choiceOf(raw: unknown): 'on' | 'off' | null {
  if (raw !== 'on' && raw !== 'off' && raw !== null) throw fail('request.required', { field: 'choice' })
  return raw
}

export function tallyModeOf(raw: unknown): TallyMode {
  if (!isTallyMode(raw)) throw fail('request.required', { field: 'mode' })
  return raw
}

export function tallyDraftOf(raw: unknown): TallyServerDraft | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail('request.required', { field: 'server' })
  const fields = raw as Record<string, unknown>
  const [host, port, name, readerPassword, writerPassword] = (['host', 'port', 'name', 'readerPassword', 'writerPassword'] as const).map((field) => textOf(fields[field], field))
  return { host: host!, port: port!, name: name!, readerPassword: readerPassword!, writerPassword: writerPassword! }
}

/** An entry as `.mcp.json` writes it; the package service checks it has a command or a url. */
export function serverOf(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('request.required', { field: 'server' })
  return raw as Record<string, unknown>
}

export function codeOf(body: Record<string, unknown>): string {
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (code === '') throw fail('request.required', { field: 'code' })
  return code
}

export function skillsOf(body: Record<string, unknown>): string[] {
  const { skills } = body
  if (!Array.isArray(skills) || !skills.every((item) => typeof item === 'string')) throw fail('packages.noSkills', {})
  return skills
}

export function listOf(body: Record<string, unknown>, code: Extract<NoticeCode, 'request.taskList' | 'request.projectList'>): string[] {
  const { order } = body
  if (!Array.isArray(order) || !order.every((item) => typeof item === 'string')) throw fail(code, {})
  return order
}


