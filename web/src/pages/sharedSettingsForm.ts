import { EXECUTION_MODES } from '../../../src/agent/providers.js'
import { CI_KINDS } from '../../../src/ci/model.js'
import type { Language } from '../../../src/language.js'
import type { CacheTtl, SharedForm } from '../../../src/state.js'
import { countFrom } from '../ui/tokens.js'
import { protectionOf, protectionText } from './protectionDraft.js'
import type { Value, Values } from './settingsDraft.js'
import { linesOf, minutesOf, RULE_KEYS, rulesOf, rulesText, sameBy, sharesOf, sharesText, wholeOf } from './settingsParts.js'
import { lineOf, linesText, pairOf } from './settingsRows.js'
import { providerMap, providerValues } from './settingsRun.js'

export const EXECUTED = Object.keys(EXECUTION_MODES)

const sameLines = sameBy(['hiddenSkills', 'allowedHosts', 'moves', ...RULE_KEYS])
export const same = (key: string, a: Value, b: Value) =>
  key === 'modelPrompts' ? JSON.stringify(promptsOf(a as string)) === JSON.stringify(promptsOf(b as string)) : sameLines(key, a, b)

/** The prompt rows of the draft (a JSON list of `[model, prompt]`), blank ones left out. */
export const promptsOf = (text: string): [string, string][] =>
  (JSON.parse(text) as [string, string][]).map(([model, prompt]): [string, string] => [model.trim(), prompt.trim()]).filter(([model, prompt]) => model !== '' && prompt !== '')

export const valuesOf = (form: SharedForm): Values => ({
  protection: protectionText(form.protection),
  parallel: String(form.parallel),
  brief: form.brief === null ? '' : String(form.brief),
  ...rulesText(form.chain),
  provider: form.provider,
  ...providerValues('models', form.models),
  ...providerValues('accounts', form.accounts),
  ...providerValues('execution', form.execution, EXECUTED),
  ...providerValues('cli', form.cli),
  modelPrompts: JSON.stringify(Object.entries(form.modelPrompts)),
  prompt: form.prompt ?? '',
  language: form.language ?? '',
  promptLanguage: form.promptLanguage,
  hiddenSkills: form.hiddenSkills.join('\n'),
  cacheTtl: form.cacheTtl ?? '',
  autoCompactWindow: form.autoCompactWindow === null ? '' : String(form.autoCompactWindow),
  codexAutoCompactWindow: form.codexAutoCompactWindow === null ? '' : String(form.codexAutoCompactWindow),
  openCodeAutoCompactWindow: form.openCodeAutoCompactWindow === null ? '' : String(form.openCodeAutoCompactWindow),
  keepWarm: String(form.keepWarm),
  attachmentLimit: String(form.attachmentLimit),
  backupDir: form.backup.dir ?? '',
  backupKeep: String(form.backup.keep),
  allowedHosts: form.allowedHosts.join('\n'),
  window: String(form.context.window),
  warn: String(form.context.warn),
  danger: String(form.context.danger),
  minTasks: String(form.stats.compare.minTasks),
  minSessions: String(form.stats.compare.minSessions),
  days: String(form.stats.compare.days),
  otherBelow: String(form.stats.otherBelow),
  contextHandoffs: form.contextHandoffs,
  checkpointTokens: form.stats.checkpointTokens === null ? '' : String(form.stats.checkpointTokens),
  ...sharesText(form.stats.checkpointShares),
  moves: linesText(Object.entries(form.stats.moves).map(lineOf)),
  updatesCheck: form.updates.check,
  updatesNotify: form.updates.notify,
  fillMilestone: form.fillMilestone,
  defaultGit: form.defaultGit === null ? '' : String(form.defaultGit),
  // No field of its own: the setup writes it, the form carries it as it is.
  setupPassed: form.setupPassed,
  cliCheck: form.cliCheck,
  guard: form.ci.guard,
  kinds: form.ci.kinds,
  wait: form.ci.waitMinutes === null ? '' : String(form.ci.waitMinutes),
  recheck: form.ci.recheckMain,
  fixTask: form.ci.fixTask,
  rerun: form.ci.rerunFailed,
})

export const amountOf = (text: string): number | undefined => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined)

/** What the service gets; `undefined` while a number field holds something else, or a moved folder lacks a side. The service judges the ranges. */
export function formOf(values: Values): SharedForm | undefined {
  const text = (key: string) => values[key] as string
  const protection = protectionOf(text('protection'))
  if (protection === undefined) return undefined
  const numbers = ['parallel', 'window', 'minTasks', 'minSessions', 'days', 'keepWarm', 'attachmentLimit', 'backupKeep'].map((key) =>
    key === 'window' ? (countFrom(text(key), 0) ?? undefined) : wholeOf(text(key), 0),
  )
  const [warn, danger, otherBelow] = ['warn', 'danger', 'otherBelow'].map((key) => amountOf(text(key)))
  const checkpointTokens = countFrom(text('checkpointTokens'), 0)
  const autoCompactWindow = countFrom(text('autoCompactWindow'), 1)
  const codexAutoCompactWindow = countFrom(text('codexAutoCompactWindow'), 1)
  const openCodeAutoCompactWindow = countFrom(text('openCodeAutoCompactWindow'), 1)
  if (autoCompactWindow === undefined || codexAutoCompactWindow === undefined || openCodeAutoCompactWindow === undefined) return undefined
  const waitMinutes = minutesOf(text('wait'))
  const [parallel, window, minTasks, minSessions, days, keepWarm, attachmentLimit, backupKeep] = numbers
  const moves = linesOf(text('moves')).map(pairOf)
  const checkpointShares = sharesOf(values)
  if (numbers.includes(undefined) || warn === undefined || danger === undefined || otherBelow === undefined || checkpointTokens === undefined || waitMinutes === undefined) return undefined
  if (checkpointShares === undefined) return undefined
  if (moves.some(([from, to]) => from === '' || to === '')) return undefined
  const language = text('language')
  return {
    parallel: parallel!,
    brief: text('brief') === '' ? null : text('brief') === 'true',
    chain: rulesOf(values as Record<(typeof RULE_KEYS)[number], Value>),
    provider: text('provider'),
    models: providerMap('models', values),
    accounts: providerMap('accounts', values),
    execution: providerMap('execution', values, EXECUTED),
    cli: providerMap('cli', values),
    modelPrompts: Object.fromEntries(promptsOf(text('modelPrompts'))),
    prompt: text('prompt').trim() === '' ? null : text('prompt'),
    language: language === '' ? null : (language as Language),
    promptLanguage: text('promptLanguage') as Language,
    protection,
    hiddenSkills: linesOf(text('hiddenSkills')),
    cacheTtl: text('cacheTtl') === '' ? null : (text('cacheTtl') as CacheTtl),
    autoCompactWindow,
    codexAutoCompactWindow,
    openCodeAutoCompactWindow,
    contextHandoffs: values.contextHandoffs as boolean,
    keepWarm: keepWarm!,
    attachmentLimit: attachmentLimit!,
    backup: { dir: text('backupDir').trim() === '' ? null : text('backupDir').trim(), keep: backupKeep! },
    defaultGit: text('defaultGit') === '' ? null : text('defaultGit') === 'true',
    setupPassed: values.setupPassed as SharedForm['setupPassed'],
    cliCheck: values.cliCheck as boolean,
    allowedHosts: linesOf(text('allowedHosts')),
    context: { window: window!, warn, danger },
    stats: {
      compare: { minTasks: minTasks!, minSessions: minSessions!, days: days! },
      moves: Object.fromEntries(moves),
      otherBelow,
      checkpointTokens,
      checkpointShares,
    },
    updates: { check: values.updatesCheck as boolean, notify: values.updatesNotify as boolean },
    ci: {
      guard: values.guard as boolean,
      kinds: CI_KINDS.filter((kind) => (values.kinds as readonly string[]).includes(kind)),
      waitMinutes,
      recheckMain: values.recheck as boolean,
      fixTask: values.fixTask as boolean,
      rerunFailed: values.rerun as boolean,
    },
    fillMilestone: values.fillMilestone as boolean,
  }
}
