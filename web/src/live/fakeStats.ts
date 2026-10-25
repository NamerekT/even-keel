import type {
  AccountTokens,
  LimitCoverage,
  PeriodQuery,
  StatsAnswer,
  StatsCell,
  StatsFilter,
  StatsHistory,
  StatsLimitWindow,
  StatsPeriod,
  StatsStuck,
  StatsTaskDetail,
  StatsTaskRow,
  StatsTotals,
} from '../../../src/stats/model.js'
import type { CheckpointThreshold } from '../../../src/stats/checkpoint.js'
import { TALLY_DISABLED, TALLY_UNCHOSEN } from '../../../src/stats/mode.js'
import { addDays, bucketOf, dayCount, localDay, previousRange, type DayRange } from '../stats/period.js'
import { fakeTaskSteps } from './fakeSteps.js'

const TRACKED = ['ABC', 'DEMO', 'XYZ', 'OPS']
const FOLDERS = ['yaml-tools', 'notes', 'dotfiles', 'homepage', 'game-jam', 'scratch']
const COMPONENTS = ['Web', 'Core', null]
const REASONS = ['broken_tooling', 'debug_loop', 'unclear_task', 'waiting_user', null]
const TITLES = [
  'Перевести сборку на новый планировщик',
  'Склад без лишних полок',
  'Сохранения: переезд на формат 3',
  'Карта видит только знание игрока',
  'Очередь задач: перетаскивание',
  'Отчёт о расходе по неделям',
  'Импорт старых профилей',
  'Тёмная тема для настроек',
]

interface Profile {
  project: string
  start: string
  end: string | null
  weight: number
  busy: number
}

const PROFILES: Profile[] = [
  { project: 'ABC', start: '2024-02-12', end: null, weight: 9, busy: 0.7 },
  { project: 'DEMO', start: '2025-06-02', end: null, weight: 6, busy: 0.6 },
  { project: 'XYZ', start: '2023-11-06', end: '2025-08-31', weight: 5, busy: 0.5 },
  { project: 'OPS', start: '2026-03-16', end: null, weight: 3, busy: 0.45 },
  { project: 'yaml-tools', start: '2024-09-01', end: '2025-02-28', weight: 4, busy: 0.4 },
  { project: 'notes', start: '2023-11-20', end: null, weight: 1, busy: 0.3 },
  { project: 'dotfiles', start: '2024-01-08', end: null, weight: 0.6, busy: 0.15 },
  { project: 'homepage', start: '2025-03-03', end: '2025-05-30', weight: 3, busy: 0.5 },
  { project: 'game-jam', start: '2026-07-20', end: '2026-08-02', weight: 8, busy: 0.9 },
  { project: 'scratch', start: '2023-11-06', end: null, weight: 0.4, busy: 0.25 },
]

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function scale(filter: StatsFilter, project: string): number {
  if (filter.scope === 'chain' && !TRACKED.includes(project)) return 0
  const scope = filter.scope === 'chain' ? 0.7 : 1
  const account = filter.account === null ? 1 : filter.account === 'global' ? 0.65 : 0.35
  return scope * account
}

export function failure<T>(mode: string | null): StatsAnswer<T> | null {
  if (mode === 'off') return { state: 'off', reason: 'TALLY_DB_NAME, TALLY_READER_PASSWORD' }
  if (mode === TALLY_DISABLED || mode === TALLY_UNCHOSEN) return { state: 'off', reason: mode }
  if (mode === 'error') return { state: 'error', error: 'connect ETIMEDOUT 100.64.0.1:5432' }
  if (mode === 'newer') return { state: 'newer', version: 3, known: 2 }
  return null
}

export function fakeCheckpoints(mode: string | null): StatsAnswer<CheckpointThreshold[]> {
  return (
    failure<CheckpointThreshold[]>(mode) ?? {
      state: 'ok',
      data: [
        { project: 'ABC', first: 187_000, source: 'calibrated', handoffs: 163, sessions: 446 },
        { project: 'DEMO', first: 200_000, source: 'default', handoffs: 12, sessions: 31 },
        { project: 'XYZ', first: 200_000, source: 'default', handoffs: 0, sessions: 0 },
        { project: 'OPS', first: 215_000, source: 'calibrated', handoffs: 24, sessions: 58 },
      ],
    }
  )
}

/** Today's spend by account folder: the API accounts of `?account=api` and the one added in the fake. */
export function fakeSpend(mode: string | null): StatsAnswer<Record<string, number>> {
  return failure<Record<string, number>>(mode) ?? { state: 'ok', data: { global: 38.42, 'jane.roe': 4.1, 'ci-key': 12.07, api: 0.004 } }
}

export function fakeTokens(mode: string | null): StatsAnswer<Record<string, AccountTokens>> {
  return failure<Record<string, AccountTokens>>(mode) ?? { state: 'ok', data: { opencode: { day: 4_820_000, month: 61_300_000 }, copilot: { day: 0, month: 912_000 } } }
}

const LIMIT_DAYS = 20

function limitCoverage(): LimitCoverage {
  const today = localDay(new Date())
  return { from: addDays(today, -LIMIT_DAYS), to: today }
}

// Weekly windows of every account that overlap the range and the snapshots, the last one still open.
function limitWindows(filter: StatsFilter, range: DayRange): StatsLimitWindow[] {
  const coverage = limitCoverage()
  const accounts = filter.account === null ? ['global', 'work'] : [filter.account]
  return accounts.flatMap((account, index) => {
    const next = random(account.length * 613)
    const windows: StatsLimitWindow[] = []
    for (let reset = addDays(coverage.to, 3 + index * 2); addDays(reset, -7) >= addDays(coverage.from, -7); reset = addDays(reset, -7)) {
      if (addDays(reset, -7) > range.to || reset <= range.from) continue
      const open = reset > coverage.to
      windows.unshift({ account, resetsAt: `${reset}T13:00:00.000Z`, peak: open ? Math.round(20 + next() * 40) : Math.round(85 + next() * 15), open })
    }
    return windows
  })
}

function rows(filter: StatsFilter): { day: string; project: string; cost: number; sessions: number; limit: number }[] {
  const today = localDay(new Date())
  const limitFrom = limitCoverage().from
  const list = []
  for (const profile of PROFILES) {
    const factor = scale(filter, profile.project)
    if (factor === 0) continue
    const next = random(profile.project.length * 7919 + profile.weight * 31)
    const end = profile.end !== null && profile.end < today ? profile.end : today
    for (let day = profile.start; day <= end; day = addDays(day, 1)) {
      const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())
      const roll = next()
      if (roll > profile.busy * (weekend ? 0.4 : 1)) continue
      const cost = Number((profile.weight * (0.3 + next() * 2.2) * factor).toFixed(2))
      const sessions = Math.max(1, Math.round(cost / 4 + next() * 2))
      list.push({ day, project: profile.project, cost, sessions, limit: day >= limitFrom ? Number((cost * 0.11).toFixed(3)) : 0 })
    }
  }
  return list.sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project))
}

export function fakeHistory(mode: string | null, filter: StatsFilter): StatsAnswer<StatsHistory> {
  const failed = failure<StatsHistory>(mode)
  if (failed !== null) return failed
  const list = mode === 'empty' ? [] : rows(filter)
  const totals = new Map<string, number>()
  for (const row of list) totals.set(row.project, (totals.get(row.project) ?? 0) + row.cost)
  const projects = [...totals].sort((a, b) => b[1] - a[1]).map(([project]) => project)
  const days = [...new Set(list.map((row) => row.day))]
  const dayIndex = new Map(days.map((day, index) => [day, index]))
  const cells: StatsCell[] = list.map((row) => [dayIndex.get(row.day)!, projects.indexOf(row.project), row.cost, row.sessions, row.limit])
  return {
    state: 'ok',
    data: {
      at: new Date().toISOString(),
      accounts: ['global', 'work'],
      tracked: TRACKED,
      projects,
      days,
      cells,
      limits: mode === 'empty' ? null : limitCoverage(),
    },
  }
}

function totals(list: ReturnType<typeof rows>, range: DayRange): StatsTotals {
  const within = list.filter((row) => row.day >= range.from && row.day <= range.to)
  const cost = within.reduce((sum, row) => sum + row.cost, 0)
  const sessions = within.reduce((sum, row) => sum + row.sessions, 0)
  const limit = within.reduce((sum, row) => sum + row.limit, 0)
  return {
    cost,
    messages: Math.round(cost * 17),
    sessions,
    tasks: Math.round(within.filter((row) => TRACKED.includes(row.project)).length / 3),
    unpriced: 0,
    limit: within.length === 0 ? null : limit,
    stuckCost: cost * 0.13,
  }
}

function share(cost: number, parts: [string, number][]): { key: string; cost: number }[] {
  return cost === 0 ? [] : parts.map(([key, part]) => ({ key, cost: cost * part }))
}

function stuckSpan(id: number, task: string | null, project: string, at: string, next: () => number): StatsStuck {
  const to = new Date(`${at}T${String(10 + Math.floor(next() * 10)).padStart(2, '0')}:20:00`)
  return {
    id: String(id),
    task,
    project,
    sessionId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    fromAt: new Date(to.getTime() - (10 + next() * 40) * 60_000).toISOString(),
    toAt: to.toISOString(),
    kinds: [['failures', 'repeat'], ['denied'], ['reread', 'compact'], ['no_commit']][id % 4]!,
    reason: REASONS[id % REASONS.length]!,
    note: id % 3 === 0 ? null : 'Сессия трижды запускала один и тот же тест без правки между запусками.',
  }
}

export function fakePeriod(mode: string | null, query: PeriodQuery): StatsAnswer<StatsPeriod> {
  const failed = failure<StatsPeriod>(mode)
  if (failed !== null) return failed
  const chosen = query.projects === null ? null : new Set(query.projects)
  const list = (mode === 'empty' ? [] : rows(query)).filter((row) => chosen === null || chosen.has(row.project))
  const range = { from: query.from, to: query.to }
  const current = totals(list, range)
  const next = random(dayCount(range) * 131 + list.length)

  const byProject = new Map<string, number>()
  for (const row of list) {
    if (row.day >= range.from && row.day <= range.to) byProject.set(row.project, (byProject.get(row.project) ?? 0) + row.cost)
  }
  const tasks: StatsTaskRow[] = []
  for (const [project, cost] of byProject) {
    if (!TRACKED.includes(project)) continue
    const count = Math.max(1, Math.min(40, Math.round(cost / 25)))
    for (let index = 0; index < count; index++) {
      const sessions = 1 + Math.floor(next() * 5)
      const estimateH = next() > 0.35 ? Math.round((0.25 + next() * 3) * 4) / 4 : null
      const activeS = Math.round(sessions * 900 * (0.4 + next() * 1.8))
      const waitS = next() > 0.5 ? Math.round(next() * 5400) : 0
      tasks.push({
        task: `${project}-${100 - index * 3}`,
        project,
        title: TITLES[(index + project.length) % TITLES.length]!,
        status: index === 0 ? 'In Progress' : 'Done',
        url: null,
        cost: (cost / count) * (0.3 + next() * 1.4),
        limit: (cost / count) * 0.11,
        sessions,
        relays: next() > 0.8 ? 1 : 0,
        checkpoints: sessions > 3 ? sessions - 2 : 0,
        restarts: next() > 0.9 ? 1 : 0,
        compactsAuto: next() > 0.75 ? 1 + Math.floor(next() * 2) : 0,
        compactsManual: next() > 0.9 ? 1 : 0,
        spans: next() > 0.7 ? 1 + Math.floor(next() * 3) : 0,
        rework: next() > 0.9,
        estimateH,
        activeS,
        waitS,
        totalS: activeS + waitS + Math.round(next() * 7200),
        done: index !== 0,
        component: COMPONENTS[(index + project.length) % COMPONENTS.length]!,
        model: ['opus', 'sonnet', 'sol', 'luna', 'astra', 'terra', 'gpt'][Math.floor(next() * 7)]!,
      })
    }
  }
  tasks.sort((a, b) => b.cost - a.cost)

  const activeDays = [...new Set(list.filter((row) => row.day >= range.from && row.day <= range.to).map((row) => row.day))]
  const weekly = new Map<string, number>()
  for (const day of activeDays) {
    if (next() < 0.3) weekly.set(bucketOf(day, 'week'), (weekly.get(bucketOf(day, 'week')) ?? 0) + 1)
  }
  const weeks = [...weekly].flatMap(([week, spans]) =>
    REASONS.map((reason, index) => ({ week, reason, spans: Math.max(0, spans + 1 - index) })).filter((each) => each.spans > 0),
  )
  const stuck = activeDays
    .slice(-20)
    .reverse()
    .map((day, index) => {
      const project = list.find((row) => row.day === day)!.project
      return stuckSpan(index + 1, TRACKED.includes(project) ? `${project}-${90 + index}` : null, project, day, next)
    })

  return {
    state: 'ok',
    data: {
      query,
      at: new Date().toISOString(),
      current,
      previous: totals(list, previousRange(range)),
      limits: mode === 'empty' ? null : limitCoverage(),
      windows: mode === 'empty' ? [] : limitWindows(query, range),
      models: share(current.cost, [
        ['opus', 0.4], ['sonnet', 0.2], ['sol', 0.15], ['luna', 0.1], ['astra', 0.05],
        ['terra', 0.04], ['haiku', 0.03], ['gpt', 0.02], ['other', 0.01],
      ]),
      entrypoints: share(current.cost, query.scope === 'chain' ? [['chain', 1]] : [['chain', 0.48], ['vscode', 0.3], ['desktop', 0.12], ['cli', 0.08], ['tally-classify', 0.02]]),
      tasks,
      weeks,
      stuck,
    },
  }
}

export function fakeTask(mode: string | null, task: string): StatsAnswer<StatsTaskDetail> {
  const failed = failure<StatsTaskDetail>(mode)
  if (failed !== null) return failed
  const next = random(task.length * 977 + Number(task.split('-')[1] ?? 0))
  const project = task.split('-')[0]!
  const reasons = [null, 'relay', 'checkpoint', 'checkpoint', 'restart']
  let at = Date.now() - (2 + next() * 5) * 86_400_000
  const sessions = Array.from({ length: 1 + Math.floor(next() * 5) }, (_, index) => {
    const firstAt = at + next() * 3_600_000
    const lastAt = firstAt + (0.5 + next() * 3) * 3_600_000
    at = lastAt + next() * 20 * 3_600_000
    return {
      sessionId: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
      title: TITLES[index % TITLES.length]!,
      reason: index === 0 ? 'start' : reasons[index % reasons.length]!,
      model: index % 3 === 2 ? 'claude-sonnet-5-5' : 'claude-opus-5-5',
      firstAt: new Date(firstAt).toISOString(),
      lastAt: new Date(lastAt).toISOString(),
      cost: 2 + next() * 12,
      account: index % 3 === 1 ? 'jane.roe' : 'global',
    }
  })
  const spans = sessions
    .filter(() => next() > 0.5)
    .map((session, index) => {
      const span = stuckSpan(index + 1, task, project, session.firstAt.slice(0, 10), next)
      const from = Date.parse(session.firstAt) + (Date.parse(session.lastAt) - Date.parse(session.firstAt)) * 0.3
      return { ...span, sessionId: session.sessionId, fromAt: new Date(from).toISOString(), toAt: new Date(from + 25 * 60_000).toISOString() }
    })
  const compactions = sessions
    .filter(() => next() > 0.6)
    .map((session) => {
      const at = Date.parse(session.firstAt) + (Date.parse(session.lastAt) - Date.parse(session.firstAt)) * 0.7
      const manual = next() > 0.8
      return { sessionId: session.sessionId, at: new Date(at).toISOString(), trigger: manual ? 'manual' : 'auto', preTokens: manual ? 180_000 : 217_000, postTokens: 29_000 }
    })
  return { state: 'ok', data: { task, sessions, spans, steps: fakeTaskSteps(task), compactions } }
}
