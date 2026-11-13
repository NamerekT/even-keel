import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import { DEFAULT_PROTECTION } from '../../../src/sessions/protection.js'
import { protectionOf, protectionText } from './protectionDraft.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { EvenKeelState, OwnKey, OwnValues, ProjectForm, SharedForm, Standard } from '../../../src/state.js'
import { linkedProfile } from './ProjectTracker.js'
import { effectiveRules } from './ruleRows.js'
import type { Value, Values } from './settingsDraft.js'
import { linesOf, minutesOf, RULE_KEYS, rulesOf, rulesText, sharesOf, sharesText, wholeOf } from './settingsParts.js'
import { providerMap, providerValues } from './settingsRun.js'
import { countFrom } from '../ui/tokens.js'

/** The project's settings form as the panel's draft holds it, and back: what `SettingsPanel` edits and sends. */

export const remoteKey = (kind: CiKind) => `remote.${kind}`

/** The rules of the tracker profile the project runs on: between the shared ones and the project's own (BTN-334). */
export const profileOf = (state: EvenKeelState | null, project: string, tracker: string) =>
  state === null ? undefined : linkedProfile(state.profiles.profiles.filter((profile) => profile.kind === tracker), project)

/** `form.chain` holds no profile: a key the project leaves unset shows the profile's value, the one in force. */
export const valuesOf = (form: ProjectForm, profileRules: Partial<ChainRules>): Values => ({
  protection: form.own.protection === undefined ? '' : protectionText(form.protection),
  repo: form.repo,
  branch: form.branch,
  tracker: form.tracker,
  trackerProject: form.trackerProject ?? '',
  slot: String(form.slot),
  color: form.color === null ? '' : String(form.color),
  brief: form.brief === null ? '' : String(form.brief),
  ...rulesText(effectiveRules(form.chain, form.ownRules, profileRules)),
  prompt: form.prompt ?? '',
  beforeStart: form.beforeStart.join('\n'),
  check: form.check.join('\n'),
  afterGreen: form.afterGreen.join('\n'),
  // A switch the project may leave to the shared settings: '' — as shared, 'true' or 'false' — its own.
  guard: switchText(form.own['ci.guard']),
  ownKinds: form.own['ci.kinds'] !== undefined,
  kinds: form.ci.kinds,
  ownWait: form.own['ci.waitMinutes'] !== undefined,
  wait: form.ci.waitMinutes === null ? '' : String(form.ci.waitMinutes),
  recheck: switchText(form.own['ci.recheckMain']),
  fixTask: switchText(form.own['ci.fixTask']),
  rerun: switchText(form.own['ci.rerunFailed']),
  pullRequests: form.pullRequests,
  testProject: form.testProject,
  intakeLabel: form.intakeLabel ?? '',
  mergeInto: form.mergeInto ?? '',
  carryAgent: form.carryAgent,
  ...Object.fromEntries(CI_KINDS.map((kind) => [remoteKey(kind), form.remoteProfiles[kind] ?? ''])),
  fillMilestone: switchText(form.own.fillMilestone),
  changelog: form.changelog,
  // The rows of the standards editor as JSON: the masks stay as typed, a comma between them, until they are sent.
  standards: standardsText(form.standards),
  provider: form.provider ?? '',
  ...providerValues('models', form.models),
  ...providerValues('accounts', form.accounts),
  promptLanguage: form.own.promptLanguage ?? '',
  cacheTtl: form.own.cacheTtl === undefined ? '' : (form.own.cacheTtl ?? CLI_TTL),
  ownAutoCompact: form.own.autoCompactWindow !== undefined,
  autoCompactWindow: form.autoCompactWindow === null ? '' : String(form.autoCompactWindow),
  ownCodexCompact: form.own.codexAutoCompactWindow !== undefined,
  codexAutoCompactWindow: form.codexAutoCompactWindow === null ? '' : String(form.codexAutoCompactWindow),
  ownOpenCodeCompact: form.own.openCodeAutoCompactWindow !== undefined,
  openCodeAutoCompactWindow: form.openCodeAutoCompactWindow === null ? '' : String(form.openCodeAutoCompactWindow),
  contextHandoffs: switchText(form.own.contextHandoffs),
  ownCheckpoint: form.own['stats.checkpointTokens'] !== undefined,
  checkpointTokens: form.checkpointTokens === null ? '' : String(form.checkpointTokens),
  // The panel sets the three shares together: any of them the project's own makes all three its own.
  ownShares: OWN_SHARES.some((key) => form.own[key] !== undefined),
  ...sharesText(form.checkpointShares),
})
const OWN_SHARES = ['stats.checkpointShares.first', 'stats.checkpointShares.late', 'stats.checkpointShares.hard'] as const satisfies readonly OwnKey[]
const switchText = (value: boolean | undefined) => (value === undefined ? '' : String(value))
export const switchOf = (text: string) => (text === '' ? undefined : text === 'true')
/** The choice of the cache lifetime that leaves it to Claude Code, as against '' — as shared. */
export const CLI_TTL = 'cli'
/** Empty — calibrated; `undefined` — no token count. */
export const checkpointOf = (text: string): number | null | undefined => countFrom(text, 0)
export const compactWindowOf = (text: string): number | null | undefined => countFrom(text, 1)
/** The switch that makes a provider's compaction window the project's own. */
export const WINDOW_FLAGS = { autoCompactWindow: 'ownAutoCompact', codexAutoCompactWindow: 'ownCodexCompact', openCodeAutoCompactWindow: 'ownOpenCodeCompact' } as const

/** A standard as the editor holds it: the masks as typed, a comma between them. */
export interface StandardRow {
  doc: string
  files: string
  except: string
  shots: boolean
}

export const standardRows = (text: string): StandardRow[] => JSON.parse(text) as StandardRow[]
export const rowsText = (rows: StandardRow[]) => JSON.stringify(rows)
const standardsText = (standards: Standard[]) =>
  rowsText(standards.map((standard) => ({ doc: standard.doc, files: standard.files.join(', '), except: standard.except.join(', '), shots: standard.shots })))
/** The masks of a row's field: split at commas and line breaks, the empty ones dropped. */
export const masksOf = (text: string) => text.split(/[,\n]/).map((mask) => mask.trim()).filter((mask) => mask !== '')
const standardsOfText = (text: string): Standard[] =>
  standardRows(text).map((row) => ({ doc: row.doc.trim(), files: masksOf(row.files), except: masksOf(row.except), shots: row.shots }))

/** The project's own values of the keys Even Keel sets too; `undefined` while an own number field holds something else. */
function ownOf(values: Values): OwnValues | undefined {
  const text = (key: string) => values[key] as string
  const on = (key: string) => values[key] as boolean
  const waitMinutes = on('ownWait') ? minutesOf(text('wait')) : null
  const checkpointTokens = on('ownCheckpoint') ? checkpointOf(text('checkpointTokens')) : null
  const autoCompactWindow = on('ownAutoCompact') ? compactWindowOf(text('autoCompactWindow')) : null
  const codexWindow = on('ownCodexCompact') ? compactWindowOf(text('codexAutoCompactWindow')) : null
  const openCodeWindow = on('ownOpenCodeCompact') ? compactWindowOf(text('openCodeAutoCompactWindow')) : null
  const shares = on('ownShares') ? sharesOf(values) : null
  const windows = [autoCompactWindow, codexWindow, openCodeWindow]
  if (waitMinutes === undefined || checkpointTokens === undefined || windows.includes(undefined) || shares === undefined) return undefined
  const kinds = values.kinds as readonly string[]
  const ttl = text('cacheTtl')
  const entries: [OwnKey, unknown][] = [
    ['protection', text('protection') === '' ? undefined : protectionOf(text('protection'))],
    ['ci.guard', switchOf(text('guard'))],
    ['ci.kinds', on('ownKinds') ? CI_KINDS.filter((kind) => kinds.includes(kind)) : undefined],
    ['ci.waitMinutes', on('ownWait') ? waitMinutes : undefined],
    ['ci.recheckMain', switchOf(text('recheck'))],
    ['ci.fixTask', switchOf(text('fixTask'))],
    ['ci.rerunFailed', switchOf(text('rerun'))],
    ['fillMilestone', switchOf(text('fillMilestone'))],
    ['promptLanguage', text('promptLanguage') === '' ? undefined : text('promptLanguage')],
    ['cacheTtl', ttl === '' ? undefined : ttl === CLI_TTL ? null : ttl],
    ['autoCompactWindow', on('ownAutoCompact') ? autoCompactWindow : undefined],
    ['codexAutoCompactWindow', on('ownCodexCompact') ? codexWindow : undefined],
    ['openCodeAutoCompactWindow', on('ownOpenCodeCompact') ? openCodeWindow : undefined],
    ['contextHandoffs', switchOf(text('contextHandoffs'))],
    ['stats.checkpointTokens', on('ownCheckpoint') ? checkpointTokens : undefined],
    ['stats.checkpointShares.first', shares?.first],
    ['stats.checkpointShares.late', shares?.late],
    ['stats.checkpointShares.hard', shares?.hard],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as OwnValues
}

/** The project's own value of a key, else the shared one. */
const ownOr = <K extends OwnKey>(own: OwnValues, key: K, shared: Exclude<OwnValues[K], undefined>) => (key in own ? (own[key] as typeof shared) : shared)

/**
 * What the service gets; `undefined` while a number field holds something else. The name and the git mode are not the
 * panel's: they go as they came.
 */
export function formOf(values: Values, name: string | null, shared: SharedForm, git = true): ProjectForm | undefined {
  const text = (key: string) => values[key] as string
  if (text('protection') !== '' && protectionOf(text('protection')) === undefined) return undefined
  const on = (key: string) => values[key] as boolean
  const slot = wholeOf(text('slot'), 0)
  const own = ownOf(values)
  if (own === undefined || slot === undefined) return undefined
  const trackerProject = text('trackerProject').trim()
  return {
    name,
    testProject: on('testProject'),
    repo: text('repo').trim(),
    branch: text('branch').trim(),
    tracker: text('tracker'),
    trackerProject: trackerProject === '' ? null : trackerProject,
    slot,
    color: text('color') === '' ? null : Number(text('color')),
    brief: text('brief') === '' ? null : text('brief') === 'true',
    chain: rulesOf(values as Record<(typeof RULE_KEYS)[number], Value>),
    ownRules: [],
    prompt: text('prompt').trim(),
    beforeStart: linesOf(text('beforeStart')),
    check: linesOf(text('check')),
    afterGreen: linesOf(text('afterGreen')),
    ci: {
      guard: ownOr(own, 'ci.guard', shared.ci.guard),
      kinds: ownOr(own, 'ci.kinds', shared.ci.kinds),
      waitMinutes: ownOr(own, 'ci.waitMinutes', shared.ci.waitMinutes),
      recheckMain: ownOr(own, 'ci.recheckMain', shared.ci.recheckMain),
      fixTask: ownOr(own, 'ci.fixTask', shared.ci.fixTask),
      rerunFailed: ownOr(own, 'ci.rerunFailed', shared.ci.rerunFailed),
    },
    remoteProfiles: Object.fromEntries(CI_KINDS.flatMap((kind) => (text(remoteKey(kind)) === '' ? [] : [[kind, text(remoteKey(kind))]]))),
    pullRequests: on('pullRequests'),
    git,
    intakeLabel: text('intakeLabel').trim() === '' ? null : text('intakeLabel').trim(),
    mergeInto: text('mergeInto') === '' ? null : text('mergeInto'),
    carryAgent: on('carryAgent'),
    fillMilestone: ownOr(own, 'fillMilestone', shared.fillMilestone),
    changelog: text('changelog').trim(),
    standards: standardsOfText(text('standards')),
    provider: text('provider') === '' ? null : text('provider'),
    models: providerMap('models', values),
    accounts: providerMap('accounts', values),
    promptLanguage: ownOr(own, 'promptLanguage', shared.promptLanguage),
    cacheTtl: ownOr(own, 'cacheTtl', shared.cacheTtl),
    autoCompactWindow: ownOr(own, 'autoCompactWindow', shared.autoCompactWindow),
    codexAutoCompactWindow: ownOr(own, 'codexAutoCompactWindow', shared.codexAutoCompactWindow),
    openCodeAutoCompactWindow: ownOr(own, 'openCodeAutoCompactWindow', shared.openCodeAutoCompactWindow),
    protection: { ...(shared.protection ?? DEFAULT_PROTECTION), ...own.protection },
    contextHandoffs: ownOr(own, 'contextHandoffs', shared.contextHandoffs),
    checkpointTokens: ownOr(own, 'stats.checkpointTokens', shared.stats.checkpointTokens),
    checkpointShares: {
      first: ownOr(own, 'stats.checkpointShares.first', shared.stats.checkpointShares.first),
      late: ownOr(own, 'stats.checkpointShares.late', shared.stats.checkpointShares.late),
      hard: ownOr(own, 'stats.checkpointShares.hard', shared.stats.checkpointShares.hard),
    },
    own,
  }
}
