import type { HulyHealth } from '../../../src/huly/health.js'
import type { UsageHealth } from '../../../src/limits/usage.js'
import { formatAgo } from '../format.js'
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
  huly: HulyHealth | null
  usage: UsageHealth | null
  configError: string | null
}

const SEVERITY: Level[] = ['error', 'warn', 'ok', 'off']

export function systemChecks({ link, huly, usage, configError }: SystemInput, now: Date): Check[] {
  const server = serverCheck(link)
  if (huly === null || usage === null) return [server]
  return [server, hulyCheck(huly, now), usageCheck(usage), configCheck(configError)]
}

export function worstLevel(checks: Check[]): Level {
  return SEVERITY.find((level) => checks.some((check) => check.level === level)) ?? 'off'
}

function serverCheck(link: Link): Check {
  const name = 'Сервер Even Keel'
  if (link === 'live') return { name, level: 'ok', text: 'на связи', details: [] }
  if (link === 'connecting') return { name, level: 'warn', text: 'подключение', details: [] }
  return { name, level: 'error', text: 'нет связи', details: ['Данные на странице устарели, переподключаюсь.'] }
}

function hulyCheck(health: HulyHealth, now: Date): Check {
  const name = 'Huly'
  if (health.state === 'off') return { name, level: 'off', text: 'выключен', details: [] }
  if (health.state === 'live') return { name, level: 'ok', text: 'на связи', details: [] }
  if (health.state === 'connecting') return { name, level: 'warn', text: 'подключение', details: [] }
  const details = [health.lastOkAt === null ? null : `последний успешный опрос ${formatAgo(health.lastOkAt, now)}`, health.error]
  return { name, level: 'error', text: 'нет связи', details: details.filter((line) => line !== null) }
}

function usageCheck(health: UsageHealth): Check {
  const name = 'Лимиты'
  const details = health.reason === null ? [] : [health.reason]
  switch (health.state) {
    case 'ok':
      return { name, level: 'ok', text: 'читаются из /usage', details }
    case 'waiting':
      return { name, level: 'ok', text: 'ждут первого опроса', details }
    case 'stale':
      return { name, level: 'off', text: '/usage без данных, берутся из statusline', details }
    case 'unread':
      return { name, level: 'warn', text: '/usage не читается, берутся из statusline', details }
    case 'off':
      return { name, level: 'error', text: 'опрос /usage выключен до перезапуска', details }
  }
}

function configCheck(error: string | null): Check {
  const name = 'Конфигурация'
  if (error === null) return { name, level: 'ok', text: 'применена', details: [] }
  return { name, level: 'error', text: 'не применена', details: [error] }
}
