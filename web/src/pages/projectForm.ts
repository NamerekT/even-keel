import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { EvenKeelState, OwnKey, OwnValues, ProjectForm, SharedForm, Standard } from '../../../src/state.js'
import { linkedProfile } from './ProjectTracker.js'
import { effectiveRules } from './ruleRows.js'
import type { Value, Values } from './settingsDraft.js'
import { linesOf, minutesOf, RULE_KEYS, rulesOf, rulesText, sharesOf, sharesText, wholeOf } from './settingsParts.js'
import { providerMap, providerValues } from './settingsRun.js'

/** The project's settings form as the panel's draft holds it, and back: what `SettingsPanel` edits and sends. */

export const remoteKey = (kind: CiKind) => `remote.${kind}`

/** The rules of the tracker profile the project runs on: between the shared ones and the project's own (BTN-334). */
export const profileOf = (state: EvenKeelState | null, project: string, tracker: string) =>
  state === null ? undefined : linkedProfile(state.profiles.profiles.filter((profile) => profile.kind === tracker), project)

/** `form.chain` holds no profile: a key the project leaves unset shows the profile's value, the one in force. */
export const valuesOf = (form: ProjectForm, profileRules: Partial<ChainRules>): Values => ({
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
  pullRequests: form.pullRequests,
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
  modelLabels: form.modelLabels === null ? '' : String(form.modelLabels),
  promptLanguage: form.own.promptLanguage ?? '',
  cacheTtl: form.own.cacheTtl === undefined ? '' : (form.own.cacheTtl ?? CLI_TTL),
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
/** Empty — calibrated; `undefined` — not a whole number. */
export const tokensOf = (text: string): number | null | undefined => (text.trim() === '' ? null : wholeOf(text, 0))

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
  const checkpointTokens = on('ownCheckpoint') ? tokensOf(text('checkpointTokens')) : null
  const shares = on('ownShares') ? sharesOf(values) : null
  if (waitMinutes === undefined || checkpointTokens === undefined || shares === undefined) return undefined
  const kinds = values.kinds as readonly string[]
  const ttl = text('cacheTtl')
  const entries: [OwnKey, unknown][] = [
    ['ci.guard', switchOf(text('guard'))],
    ['ci.kinds', on('ownKinds') ? CI_KINDS.filter((kind) => kinds.includes(kind)) : undefined],
    ['ci.waitMinutes', on('ownWait') ? waitMinutes : undefined],
    ['ci.recheckMain', switchOf(text('recheck'))],
    ['ci.fixTask', switchOf(text('fixTask'))],
    ['fillMilestone', switchOf(text('fillMilestone'))],
    ['promptLanguage', text('promptLanguage') === '' ? undefined : text('promptLanguage')],
    ['cacheTtl', ttl === '' ? undefined : ttl === CLI_TTL ? null : ttl],
    ['stats.checkpointTokens', on('ownCheckpoint') ? checkpointTokens : undefined],
    ['stats.checkpointShares.first', shares?.first],
    ['stats.checkpointShares.late', shares?.late],
    ['stats.checkpointShares.hard', shares?.hard],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as OwnValues
}

/** The project's own value of a key, else the shared one. */
const ownOr = <K extends OwnKey>(own: OwnValues, key: K, shared: Exclude<OwnValues[K], undefined>) => (key in own ? (own[key] as typeof shared) : shared)

/** What the service gets; `undefined` while a number field holds something else. The name is not the panel's: it goes as it came. */
export function formOf(values: Values, name: string | null, shared: SharedForm): ProjectForm | undefined {
  const text = (key: string) => values[key] as string
  const on = (key: string) => values[key] as boolean
  const slot = wholeOf(text('slot'), 0)
  const own = ownOf(values)
  if (own === undefined || slot === undefined) return undefined
  const trackerProject = text('trackerProject').trim()
  const labels = text('modelLabels')
  return {
    name,
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
    },
    remoteProfiles: Object.fromEntries(CI_KINDS.flatMap((kind) => (text(remoteKey(kind)) === '' ? [] : [[kind, text(remoteKey(kind))]]))),
    pullRequests: on('pullRequests'),
    intakeLabel: text('intakeLabel').trim() === '' ? null : text('intakeLabel').trim(),
    mergeInto: text('mergeInto') === '' ? null : text('mergeInto'),
    carryAgent: on('carryAgent'),
    fillMilestone: ownOr(own, 'fillMilestone', shared.fillMilestone),
    changelog: text('changelog').trim(),
    standards: standardsOfText(text('standards')),
    provider: text('provider') === '' ? null : text('provider'),
    models: providerMap('models', values),
    accounts: providerMap('accounts', values),
    modelLabels: labels === '' ? null : labels === 'true',
    promptLanguage: ownOr(own, 'promptLanguage', shared.promptLanguage),
    cacheTtl: ownOr(own, 'cacheTtl', shared.cacheTtl),
    checkpointTokens: ownOr(own, 'stats.checkpointTokens', shared.stats.checkpointTokens),
    checkpointShares: {
      first: ownOr(own, 'stats.checkpointShares.first', shared.stats.checkpointShares.first),
      late: ownOr(own, 'stats.checkpointShares.late', shared.stats.checkpointShares.late),
      hard: ownOr(own, 'stats.checkpointShares.hard', shared.stats.checkpointShares.hard),
    },
    own,
  }
}
