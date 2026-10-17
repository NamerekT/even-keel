import type { Notice } from '../../../src/notice/notice.js'

/** The field of the settings a config error points at: of a project's panel, or of the shared page when `project` is null. */
export interface FieldError {
  project: string | null
  field: string
}

const RULES = ['active', 'terminal', 'requiredLabels', 'excludedLabels']
const NAMED = ['branch', 'prompt', 'tracker', 'brief', 'fillMilestone', 'language', 'promptLanguage', 'context', 'stats']
const PROJECT_WHERE = /^([A-Z][A-Z0-9_]{0,4})\.(.+)$/

const SHARED: Partial<Record<Notice['code'], string>> = {
  'config.parallel': 'parallel',
  'config.model': 'model',
  'config.modelPrompts': 'modelPrompts',
  'config.modelAlias': 'modelPrompts',
  'config.modelPromptEmpty': 'modelPrompts',
  'config.modelPromptPlaceholder': 'modelPrompts',
  'config.hiddenSkills': 'hiddenSkills',
  'config.cacheTtl': 'cacheTtl',
  'config.allowedHosts': 'allowedHosts',
  'config.contextWindow': 'context',
  'config.contextPercents': 'context',
  'config.compareKey': 'stats',
  'config.compareValue': 'stats',
  'config.statsMove': 'stats',
  'config.otherBelow': 'stats',
  'config.checkpointTokens': 'checkpointTokens',
}

/** Where a config error belongs; `null` — no field of the settings, the banner alone shows it. `trackerKeys` — the project keys of the trackers (`github`, `linear`). */
export function fieldOf(notice: Notice, trackerKeys: string[]): FieldError | null {
  const params = notice.params as Record<string, unknown>
  const shared = SHARED[notice.code]
  if (shared !== undefined) return { project: null, field: shared }
  if (notice.code === 'config.repoEmpty') return { project: notice.params.key, field: 'repo' }
  if (notice.code === 'config.slot') return { project: notice.params.key, field: 'slot' }
  if (notice.code === 'config.trackerLocked') return { project: notice.params.key, field: 'tracker' }
  if (notice.code === 'config.statusBoth') return { project: notice.params.project, field: 'chain.terminal' }
  if (notice.code === 'config.labelBoth') return { project: notice.params.project, field: 'chain.excludedLabels' }
  if (typeof params.where !== 'string') return null
  const own = PROJECT_WHERE.exec(params.where)
  const project = own?.[1] ?? null
  const [head, sub] = (own?.[2] ?? params.where).split('.')
  if (head === 'chain') return { project, field: `chain.${RULES.includes(String(params.key)) ? params.key : 'active'}` }
  if (head === 'commands') return { project, field: sub === 'check' || sub === 'afterGreen' ? sub : 'beforeStart' }
  if (head === 'ci') return { project, field: 'ci' }
  if (head !== undefined && trackerKeys.includes(head)) return { project, field: 'trackerProject' }
  if (head !== undefined && NAMED.includes(head)) return { project, field: head }
  return null
}
