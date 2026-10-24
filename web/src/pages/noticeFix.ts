import type { Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { fieldOf, type FieldError } from './settingsField.js'

type ProjectTab = 'repo' | 'tracker' | 'sessions' | 'ci'
type SharedTab = 'chain' | 'trackers' | 'models' | 'sessions' | 'ci' | 'page' | 'stats'

/**
 * Where the page fixes what a notice reports: a tab of a project's settings (`project` — the project a config error
 * names by its key; without it, the project the notice is shown at), a tab of Even Keel's settings, or the accounts.
 */
export type NoticeFix = { to: 'project'; project?: string; tab: ProjectTab } | { to: 'shared'; tab: SharedTab } | { to: 'accounts' }

const PROFILES: NoticeFix = { to: 'shared', tab: 'trackers' }
const PAGE: NoticeFix = { to: 'shared', tab: 'page' }
const ACCOUNTS: NoticeFix = { to: 'accounts' }

const BY_CODE: Partial<Record<Notice['code'], NoticeFix>> = {
  'git.noBranch': { to: 'project', tab: 'repo' },
  'git.wrongBranch': { to: 'project', tab: 'repo' },
  'forward.foreign': { to: 'project', tab: 'repo' },
  'chain.emptyLabels': { to: 'project', tab: 'tracker' },
  'chain.emptyStatus': { to: 'project', tab: 'tracker' },
  'prompt.empty': { to: 'project', tab: 'sessions' },
  'chain.unknownModel': { to: 'project', tab: 'sessions' },
  'chain.limitSpent': ACCOUNTS,
  'account.signedOut': ACCOUNTS,
  'account.loginExpired': ACCOUNTS,
  'account.activeGone': ACCOUNTS,
  'profiles.paused': PROFILES,
  'ci.noToken': PROFILES,
  'ci.denied': PROFILES,
  'review.denied': PROFILES,
  'config.token': PAGE,
  'config.tokenShape': PAGE,
}

/** The place a notice is fixed at: its own, or that of its first reason (the items, then the cause); `null` — none on the page. */
export function noticeFixOf(notice: Notice | null | undefined): NoticeFix | null {
  if (notice === null || notice === undefined) return null
  const own = BY_CODE[notice.code]
  if (own !== undefined) return own
  for (const item of notice.items ?? []) {
    const fix = noticeFixOf(item)
    if (fix !== null) return fix
  }
  return noticeFixOf(notice.cause)
}

const PROJECT_TABS: Record<ProjectTab, readonly string[]> = {
  repo: ['repo', 'branch', 'mergeInto', 'slot', 'changelog', 'color'],
  tracker: ['tracker', 'trackerProject', 'fillMilestone', 'chain'],
  sessions: ['provider', 'models', 'accounts', 'modelLabels', 'brief', 'prompt', 'beforeStart', 'promptLanguage', 'cacheTtl', 'checkpointTokens', 'checkpointShares'],
  ci: ['check', 'afterGreen', 'ci', 'pullRequests'],
}

const SHARED_TABS: Record<Exclude<SharedTab, 'trackers'>, readonly string[]> = {
  chain: ['parallel', 'brief', 'fillMilestone', 'chain'],
  models: ['provider', 'models', 'accounts', 'execution', 'cli', 'modelLabels', 'modelPrompts', 'promptLanguage'],
  sessions: ['hiddenSkills', 'context', 'checkpointTokens', 'checkpointShares', 'cacheTtl'],
  ci: ['ci'],
  page: ['language', 'allowedHosts'],
  stats: ['stats'],
}

/** The settings tab of the field a config error points at (`fieldOf`); a field of a provider (`models.claude`) goes by its head. */
export function fieldFixOf({ project, field }: FieldError): NoticeFix | null {
  const head = field.split('.')[0]!
  if (project === null) {
    const tab = (Object.keys(SHARED_TABS) as (keyof typeof SHARED_TABS)[]).find((each) => SHARED_TABS[each].includes(head))
    return tab === undefined ? null : { to: 'shared', tab }
  }
  const tab = (Object.keys(PROJECT_TABS) as ProjectTab[]).find((each) => PROJECT_TABS[each].includes(head))
  return tab === undefined ? null : { to: 'project', project, tab }
}

/** Where the page fixes the config error of the state: the tab of the field it names. */
export function configFixOf({ config, configError }: Pick<EvenKeelState, 'config' | 'configError'>): NoticeFix | null {
  if (configError === null) return null
  const keys = config.trackers.flatMap((tracker) => (tracker.projectKey === null ? [] : [tracker.projectKey.key]))
  const at = fieldOf(configError, keys)
  return at === null ? null : fieldFixOf(at)
}
