import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import type { TrackerHealth, TrackerView } from '../../../src/tracker/health.js'
import { setLanguage } from '../i18n/index.js'
import { systemChecks, worstLevel, type SystemInput } from './system.js'

setLanguage('ru')

const now = new Date('2026-10-03T12:00:00Z')
const huly = (health: TrackerHealth): TrackerView => ({ name: 'huly', kind: 'huly', title: 'Huly', projects: ['ABC'], ready: true, health, readAt: {} })
const healthy: SystemInput = {
  link: 'live',
  trackers: [huly({ state: 'live', lastOkAt: '2026-10-03T12:00:00Z', error: null })],
  usage: { state: 'ok', reason: null, since: null },
  configError: null,
}

describe('systemChecks', () => {
  it('lists the server, Huly, the limit poll and the config, all fine', () => {
    const checks = systemChecks(healthy, now)
    expect(checks.map((check) => [check.name, check.level])).toEqual([
      ['Сервер Even Keel', 'ok'],
      ['Huly', 'ok'],
      ['Лимиты', 'ok'],
      ['Конфигурация', 'ok'],
    ])
    expect(worstLevel(checks)).toBe('ok')
  })

  it('checks every tracker in use under its own title', () => {
    const linear: TrackerView = { name: 'linear', kind: 'linear', title: 'Linear', projects: ['LIN'], ready: false, health: { state: 'connecting', lastOkAt: null, error: null }, readAt: {} }
    const checks = systemChecks({ ...healthy, trackers: [...healthy.trackers!, linear] }, now)
    expect(checks.map((check) => [check.name, check.level])).toEqual([
      ['Сервер Even Keel', 'ok'],
      ['Huly', 'ok'],
      ['Linear', 'warn'],
      ['Лимиты', 'ok'],
      ['Конфигурация', 'ok'],
    ])
  })

  it('shows only the server until the first state arrives', () => {
    const checks = systemChecks({ link: 'connecting', trackers: null, usage: null, configError: null }, now)
    expect(checks).toEqual([{ name: 'Сервер Even Keel', level: 'warn', text: 'подключение', details: [] }])
    expect(worstLevel(checks)).toBe('warn')
  })

  it('explains a Huly outage with the last good poll and the error', () => {
    const down = huly({ state: 'down', lastOkAt: '2026-10-03T11:56:00Z', error: 'huly: call timed out' })
    const checks = systemChecks({ ...healthy, trackers: [down] }, now)
    expect(checks[1]).toEqual({
      name: 'Huly',
      level: 'error',
      text: 'нет связи',
      details: ['последний успешный опрос 4 мин назад', 'huly: call timed out'],
    })
    expect(worstLevel(checks)).toBe('error')
  })

  it('keeps a switched-off Huly and a limit poll without data neutral', () => {
    const checks = systemChecks(
      {
        ...healthy,
        trackers: [huly({ state: 'off', lastOkAt: null, error: null })],
        usage: { state: 'stale', reason: null, since: null },
      },
      now,
    )
    expect(checks[1]!.level).toBe('off')
    expect(checks[2]!.level).toBe('off')
    expect(worstLevel(checks)).toBe('ok')
  })

  it('warns on an unreadable /usage and fails on a switched-off poll and a broken config', () => {
    const unread = systemChecks({ ...healthy, usage: { state: 'unread', reason: notice('usage.noSession', {}), since: 'x' } }, now)
    expect(unread[2]).toMatchObject({ level: 'warn', details: ['нет читаемой строки «Current session»'] })
    expect(worstLevel(unread)).toBe('warn')

    const off = systemChecks({ ...healthy, usage: { state: 'off', reason: notice('usage.turns', { value: '1' }), since: 'x' } }, now)
    expect(off[2]).toMatchObject({ level: 'error', details: ['num_turns = 1, а не 0'] })

    const configError = notice('config.statusBoth', { project: 'ABC', status: 'In Review' })
    const config = systemChecks({ ...healthy, configError }, now)
    expect(config[3]).toMatchObject({ level: 'error', text: 'не применена', details: ['ABC: статус «In Review» и активный, и терминальный'] })
  })
})
