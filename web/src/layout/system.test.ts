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
      ['Настройки', 'ok'],
    ])
    expect(worstLevel(checks)).toBe('ok')
  })

  it('says when the limits shown were read', () => {
    const checks = systemChecks({ ...healthy, limitsAt: '2026-10-03T11:58:00Z' }, now)
    expect(checks[2]).toMatchObject({ text: 'прочитаны', note: '2 мин назад' })
    expect(systemChecks(healthy, now)[2]!.note).toBeUndefined()
  })

  it('checks every tracker in use under its own title', () => {
    const linear: TrackerView = { name: 'linear', kind: 'linear', title: 'Linear', projects: ['LIN'], ready: false, health: { state: 'connecting', lastOkAt: null, error: null }, readAt: {} }
    const checks = systemChecks({ ...healthy, trackers: [...healthy.trackers!, linear] }, now)
    expect(checks.map((check) => [check.name, check.level])).toEqual([
      ['Сервер Even Keel', 'ok'],
      ['Huly', 'ok'],
      ['Linear', 'warn'],
      ['Лимиты', 'ok'],
      ['Настройки', 'ok'],
    ])
  })

  it('shows only the server until the first state arrives', () => {
    const checks = systemChecks({ link: 'connecting', trackers: null, usage: null, configError: null }, now)
    expect(checks).toEqual([{ key: 'server', name: 'Сервер Even Keel', level: 'warn', text: 'подключение', details: [] }])
    expect(worstLevel(checks)).toBe('warn')
  })

  it('offers to reconnect to a lost server', () => {
    expect(systemChecks({ ...healthy, link: 'stale' }, now)[0]).toMatchObject({ level: 'error', fix: { kind: 'retry' } })
  })

  it('explains a Huly outage with the last good poll and the error, and sends to the profiles', () => {
    const down = huly({ state: 'down', lastOkAt: '2026-10-03T11:56:00Z', error: 'huly: call timed out' })
    const checks = systemChecks({ ...healthy, trackers: [down] }, now)
    expect(checks[1]).toEqual({
      key: 'huly',
      tracker: down,
      name: 'Huly',
      level: 'error',
      text: 'нет связи',
      details: ['последний успешный опрос 4 мин назад', 'huly: call timed out'],
      fix: { kind: 'open', fix: { to: 'shared', tab: 'trackers' } },
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
    expect(config[3]).toMatchObject({ level: 'error', text: 'не применены', details: ['ABC: статус «In Review» и активный, и терминальный'] })

    const fix = { to: 'project', project: 'ABC', tab: 'tracker' } as const
    expect(systemChecks({ ...healthy, configError, configFix: fix }, now)[3]).toMatchObject({ fix: { kind: 'open', fix } })
  })
})

describe('the Tally check', () => {
  const tally = (input: SystemInput['tally']) => systemChecks({ ...healthy, tally: input }, now).find((check) => check.key === 'tally')

  it('is left out until the state arrives', () => {
    expect(tally(null)).toBeUndefined()
  })

  it('keeps stats not set up or turned off neutral', () => {
    expect(tally({ mode: null, health: { state: 'off', lastRunAt: null } })).toMatchObject({ level: 'off', text: 'не настроена' })
    expect(tally({ mode: 'off', health: { state: 'off', lastRunAt: null } })).toMatchObject({ level: 'off' })
  })

  it('is fine while waiting for the first run and after a good one', () => {
    expect(tally({ mode: 'local', health: { state: 'waiting', lastRunAt: null } })).toMatchObject({ level: 'ok', text: 'ждёт первого прохода' })
    expect(tally({ mode: 'server', health: { state: 'ok', lastRunAt: '2026-10-03T11:58:00Z' } })).toMatchObject({ level: 'ok', text: 'собрана', note: '2 мин назад' })
  })

  it('sends a collector that fails to the stats settings', () => {
    expect(tally({ mode: 'local', health: { state: 'halted', lastRunAt: null } })).toMatchObject({ fix: { kind: 'open', fix: { to: 'shared', tab: 'stats' } } })
  })

  it('warns on a failed run and fails when halted or not collecting at all', () => {
    expect(tally({ mode: 'local', health: { state: 'failed', lastRunAt: '2026-10-03T11:58:00Z' } })).toMatchObject({ level: 'warn', details: ['Причина — в логе службы.'] })
    expect(tally({ mode: 'local', health: { state: 'halted', lastRunAt: '2026-10-03T11:58:00Z' } })).toMatchObject({ level: 'error', text: 'остановлена до перезапуска' })
    expect(tally({ mode: 'local', health: { state: 'off', lastRunAt: null } })).toMatchObject({ level: 'error', text: 'не собирается' })
  })
})
