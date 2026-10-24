import type { TrackerView } from '../../../src/tracker/health.js'
import type { UsageHealth } from '../../../src/limits/usage.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { TallyHealth, TallyMode } from '../../../src/stats/mode.js'
import type { EvenKeelState } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import type { Link } from '../live/connection.js'
import { configFixOf, noticeFixOf, type NoticeFix } from '../pages/noticeFix.js'

export type Level = 'ok' | 'warn' | 'error' | 'off'

export interface Check {
  /** Stable across states: the `/status` page's selection. A connection's is its tracker's name. */
  key: string
  name: string
  level: Level
  text: string
  /** One line under the state on `/status`: when it was last good. */
  note?: string
  details: string[]
  /** What fixes it, next to it on `/status` (BTN-357). */
  fix?: CheckFix
  /** A connection: the tracker of one profile (BTN-66). */
  tracker?: TrackerView
}

/** Reconnecting to the server, or the place the page fixes it at. */
export type CheckFix = { kind: 'retry' } | { kind: 'open'; fix: NoticeFix }

export interface SystemInput {
  link: Link
  trackers: TrackerView[] | null
  usage: UsageHealth | null
  /** When the limits now shown were read. */
  limitsAt?: string | null
  configError: Notice | null
  /** The settings tab of the field the config error names (`configFixOf`). */
  configFix?: NoticeFix | null
  tally?: { mode: TallyMode | null; health: TallyHealth } | null
}

const SEVERITY: Level[] = ['error', 'warn', 'ok', 'off']
const PROFILES: CheckFix = { kind: 'open', fix: { to: 'shared', tab: 'trackers' } }
const STATS: CheckFix = { kind: 'open', fix: { to: 'shared', tab: 'stats' } }

export const systemInput = (state: EvenKeelState | null, link: Link): SystemInput => ({
  link,
  trackers: state?.trackers ?? null,
  usage: state?.usage ?? null,
  limitsAt: state?.limits?.updatedAt ?? null,
  configError: state?.configError ?? null,
  configFix: state === null ? null : configFixOf(state),
  tally: state === null ? null : { mode: state.tally, health: state.tallyHealth },
})

export function systemChecks({ link, trackers, usage, limitsAt = null, configError, configFix = null, tally = null }: SystemInput, now: Date): Check[] {
  const server = serverCheck(link)
  if (trackers === null || usage === null) return [server]
  return [
    server,
    ...trackers.map((tracker) => trackerCheck(tracker, now)),
    usageCheck(usage, limitsAt, now),
    configCheck(configError, configFix),
    ...(tally === null ? [] : [tallyCheck(tally.mode, tally.health, now)]),
  ]
}

export function worstLevel(checks: Check[]): Level {
  return SEVERITY.find((level) => checks.some((check) => check.level === level)) ?? 'off'
}

function serverCheck(link: Link): Check {
  const base = { key: 'server', name: t.system.server }
  if (link === 'live') return { ...base, level: 'ok', text: t.system.live, details: [] }
  if (link === 'connecting') return { ...base, level: 'warn', text: t.system.connecting, details: [] }
  return { ...base, level: 'error', text: t.system.lost, details: [t.system.staleDetail], fix: { kind: 'retry' } }
}

function trackerCheck(tracker: TrackerView, now: Date): Check {
  const { health } = tracker
  const base = { key: tracker.name, name: tracker.title, tracker }
  if (health.state === 'off') return { ...base, level: 'off', text: t.system.off, details: [] }
  if (health.state === 'live') return { ...base, level: 'ok', text: t.system.live, details: [] }
  if (health.state === 'connecting') return { ...base, level: 'warn', text: t.system.connecting, details: [] }
  const details = [health.lastOkAt === null ? null : t.system.lastOk(formatAgo(health.lastOkAt, now)), health.error]
  return { ...base, level: 'error', text: t.system.lost, details: details.filter((line) => line !== null), fix: PROFILES }
}

function usageCheck(health: UsageHealth, limitsAt: string | null, now: Date): Check {
  const fix = noticeFixOf(health.reason)
  const base = {
    key: 'limits',
    name: t.system.limits,
    details: health.reason === null ? [] : [say(health.reason)],
    ...(fix === null ? {} : { fix: { kind: 'open' as const, fix } }),
  }
  switch (health.state) {
    case 'ok':
      return { ...base, level: 'ok', text: t.system.usageLive, ...(limitsAt === null ? {} : { note: formatAgo(limitsAt, now) }) }
    case 'waiting':
      return { ...base, level: 'ok', text: t.system.usageWaiting }
    case 'stale':
      return { ...base, level: 'off', text: t.system.usageStale }
    case 'unread':
      return { ...base, level: 'warn', text: t.system.usageUnread }
    case 'off':
      return { ...base, level: 'error', text: t.system.usageOff }
  }
}

function configCheck(error: Notice | null, fieldFix: NoticeFix | null): Check {
  const base = { key: 'config', name: t.system.config }
  if (error === null) return { ...base, level: 'ok', text: t.system.configOk, details: [] }
  const fix = fieldFix ?? noticeFixOf(error)
  return { ...base, level: 'error', text: t.system.configBroken, details: [say(error)], ...(fix === null ? {} : { fix: { kind: 'open', fix } }) }
}

/** Tally turned off or not set up is no fault; one meant to collect that does not is. */
function tallyCheck(mode: TallyMode | null, health: TallyHealth, now: Date): Check {
  const base = { key: 'tally', name: t.system.tally }
  const note = health.lastRunAt === null ? {} : { note: formatAgo(health.lastRunAt, now) }
  if (mode === null) return { ...base, level: 'off', text: t.system.tallyUnchosen, details: [] }
  if (mode === 'off') return { ...base, level: 'off', text: t.system.off, details: [] }
  switch (health.state) {
    case 'waiting':
      return { ...base, level: 'ok', text: t.system.tallyWaiting, details: [] }
    case 'ok':
      return { ...base, level: 'ok', text: t.system.tallyOk, ...note, details: [] }
    case 'failed':
      return { ...base, level: 'warn', text: t.system.tallyFailed, ...note, details: [t.system.tallyLog], fix: STATS }
    case 'halted':
      return { ...base, level: 'error', text: t.system.tallyHalted, details: [t.system.tallyLog], fix: STATS }
    case 'off':
      return { ...base, level: 'error', text: t.system.tallyIdle, details: [t.system.tallyLog], fix: STATS }
  }
}
