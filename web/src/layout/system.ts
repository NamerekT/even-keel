import type { TrackerView } from '../../../src/tracker/health.js'
import type { UsageHealth } from '../../../src/limits/usage.js'
import { formatAgo } from '../format.js'
import { t } from '../i18n/index.js'
import type { Link } from '../live/connection.js'

export type Level = 'ok' | 'warn' | 'error' | 'off'

export interface Check {
  name: string
  level: Level
  text: string
  details: string[]
}

export interface SystemInput {
  link: Link
  trackers: TrackerView[] | null
  usage: UsageHealth | null
  configError: string | null
}

const SEVERITY: Level[] = ['error', 'warn', 'ok', 'off']

export function systemChecks({ link, trackers, usage, configError }: SystemInput, now: Date): Check[] {
  const server = serverCheck(link)
  if (trackers === null || usage === null) return [server]
  return [server, ...trackers.map((tracker) => trackerCheck(tracker, now)), usageCheck(usage), configCheck(configError)]
}

export function worstLevel(checks: Check[]): Level {
  return SEVERITY.find((level) => checks.some((check) => check.level === level)) ?? 'off'
}

function serverCheck(link: Link): Check {
  const name = t.system.server
  if (link === 'live') return { name, level: 'ok', text: t.system.live, details: [] }
  if (link === 'connecting') return { name, level: 'warn', text: t.system.connecting, details: [] }
  return { name, level: 'error', text: t.system.lost, details: [t.system.staleDetail] }
}

function trackerCheck({ title: name, health }: TrackerView, now: Date): Check {
  if (health.state === 'off') return { name, level: 'off', text: t.system.off, details: [] }
  if (health.state === 'live') return { name, level: 'ok', text: t.system.live, details: [] }
  if (health.state === 'connecting') return { name, level: 'warn', text: t.system.connecting, details: [] }
  const details = [health.lastOkAt === null ? null : t.system.lastOk(formatAgo(health.lastOkAt, now)), health.error]
  return { name, level: 'error', text: t.system.lost, details: details.filter((line) => line !== null) }
}

function usageCheck(health: UsageHealth): Check {
  const name = t.system.limits
  const details = health.reason === null ? [] : [health.reason]
  switch (health.state) {
    case 'ok':
      return { name, level: 'ok', text: t.system.usageLive, details }
    case 'waiting':
      return { name, level: 'ok', text: t.system.usageWaiting, details }
    case 'stale':
      return { name, level: 'off', text: t.system.usageStale, details }
    case 'unread':
      return { name, level: 'warn', text: t.system.usageUnread, details }
    case 'off':
      return { name, level: 'error', text: t.system.usageOff, details }
  }
}

function configCheck(error: string | null): Check {
  const name = t.system.config
  if (error === null) return { name, level: 'ok', text: t.system.configOk, details: [] }
  return { name, level: 'error', text: t.system.configBroken, details: [error] }
}
