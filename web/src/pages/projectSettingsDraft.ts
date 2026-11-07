import type { CacheTtl, ProjectForm } from '../../../src/state.js'
import { CI_KINDS } from '../../../src/ci/model.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { profileOf, remoteKey, standardRows, valuesOf } from './projectForm.js'
import { sameProtection } from './protectionDraft.js'
import { changed, type Value } from './settingsDraft.js'
import { RULE_KEYS, SHARE_KEYS, sameBy, shown, type RuleKey } from './settingsParts.js'
import { providerKeys } from './settingsRun.js'
import { projectScope as scopeOf, useDraft } from './settingsStore.js'

// Related fields share a group, so a save of one group never leaves another half-agreeing with it.
export const GROUPS = [
  { id: 'repo', keys: ['repo', 'branch', 'mergeInto', 'carryAgent', 'slot', 'changelog', 'color', 'testProject'] },
  { id: 'tracker', keys: ['tracker', 'trackerProject', 'fillMilestone', 'intakeLabel', ...RULE_KEYS] },
  {
    id: 'sessions',
    keys: ['protection', 'provider', ...providerKeys('models'), ...providerKeys('accounts'), 'modelLabels', 'brief', 'prompt', 'beforeStart', 'promptLanguage', 'standards', 'cacheTtl', 'ownAutoCompact', 'autoCompactWindow', 'contextHandoffs', 'ownCheckpoint', 'checkpointTokens', 'ownShares', ...SHARE_KEYS],
  },
  { id: 'ci', keys: ['guard', 'check', 'afterGreen', 'ownKinds', 'kinds', 'ownWait', 'wait', 'recheck', 'fixTask', 'pullRequests', ...CI_KINDS.map(remoteKey)] },
  // Applied at once, as "Don't show again" on a banner is (BTN-759): no draft.
  { id: 'notices', keys: [] },
] as const

export type GroupId = (typeof GROUPS)[number]['id']
const KEYS: readonly string[] = GROUPS.flatMap((group) => group.keys)
export const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
const sameLines = sameBy(['beforeStart', 'check', 'afterGreen', ...RULE_KEYS])
export const same = (key: string, a: Value, b: Value) => (key === 'protection' ? sameProtection(a as string, b as string) : sameLines(key, a, b))
export const STATUS_KEYS: readonly RuleKey[] = ['active', 'terminal']

export const ttlLabel = (ttl: CacheTtl | null) => (ttl === null ? t.shared.cacheTtlAuto : ttl === '5m' ? t.shared.cacheTtl5m : t.shared.cacheTtl1h)
export const onOff = (value: boolean) => (value ? t.settings.on : t.settings.off)
export const standardsShown = (value: Value) => shown(standardRows(value as string).map((row) => row.doc || '—'))

export type Option = { value: string; label: string }
export const labelOf = (options: readonly Option[]) => (value: Value) => options.find((option) => option.value === value)?.label ?? String(value)

/** Whether a group of the project's settings holds changes nobody saved yet: the Settings tab shows it even with the panel closed. */
export function useSettingsDirty(project: string, form: ProjectForm | undefined): boolean {
  const { state } = useLive()
  const [draft] = useDraft(scopeOf(project), form === undefined ? undefined : valuesOf(form, profileOf(state, project, form.tracker)?.rules ?? {}), same)
  return draft !== undefined && changed(draft, KEYS, same).length > 0
}
