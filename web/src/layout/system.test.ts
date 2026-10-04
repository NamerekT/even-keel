import { describe, expect, it } from 'vitest'
import { systemChecks, worstLevel, type SystemInput } from './system.js'

const now = new Date('2026-10-03T12:00:00Z')
const healthy: SystemInput = {
  link: 'live',
  huly: { state: 'live', lastOkAt: '2026-10-03T12:00:00Z', error: null },
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

  it('shows only the server until the first state arrives', () => {
    const checks = systemChecks({ link: 'connecting', huly: null, usage: null, configError: null }, now)
    expect(checks).toEqual([{ name: 'Сервер Even Keel', level: 'warn', text: 'подключение', details: [] }])
    expect(worstLevel(checks)).toBe('warn')
  })

  it('explains a Huly outage with the last good poll and the error', () => {
    const huly = { state: 'down' as const, lastOkAt: '2026-10-03T11:56:00Z', error: 'huly: call timed out' }
    const checks = systemChecks({ ...healthy, huly }, now)
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
        huly: { state: 'off', lastOkAt: null, error: null },
        usage: { state: 'stale', reason: null, since: null },
      },
      now,
    )
    expect(checks[1]!.level).toBe('off')
    expect(checks[2]!.level).toBe('off')
    expect(worstLevel(checks)).toBe('ok')
  })

  it('warns on an unreadable /usage and fails on a switched-off poll and a broken config', () => {
    const unread = systemChecks({ ...healthy, usage: { state: 'unread', reason: 'no window rows', since: 'x' } }, now)
    expect(unread[2]).toMatchObject({ level: 'warn', details: ['no window rows'] })
    expect(worstLevel(unread)).toBe('warn')

    const off = systemChecks({ ...healthy, usage: { state: 'off', reason: 'paid turn', since: 'x' } }, now)
    expect(off[2]).toMatchObject({ level: 'error', details: ['paid turn'] })

    const config = systemChecks({ ...healthy, configError: 'chain.active: unknown status' }, now)
    expect(config[3]).toMatchObject({ level: 'error', text: 'не применена', details: ['chain.active: unknown status'] })
  })
})
