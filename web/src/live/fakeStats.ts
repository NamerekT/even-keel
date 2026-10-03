import type {
  PeriodQuery,
  StatsAnswer,
  StatsCell,
  StatsFilter,
  StatsHistory,
  StatsPeriod,
  StatsStuck,
  StatsTaskDetail,
  StatsTaskRow,
  StatsTotals,
} from '../../../src/stats/model.js'
import { addDays, bucketOf, dayCount, localDay, previousRange, type DayRange } from '../stats/period.js'

const BATON = ['ABC', 'DEMO', 'XYZ', 'OPS']
const FOLDERS = ['yaml-tools', 'notes', 'dotfiles', 'homepage', 'game-jam', 'scratch']
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
  if (filter.scope === 'chain' && !BATON.includes(project)) return 0
  const scope = filter.scope === 'chain' ? 0.7 : 1
  const account = filter.account === null ? 1 : filter.account === 'global' ? 0.65 : 0.35
  return scope * account
}

export function failure<T>(mode: string | null): StatsAnswer<T> | null {
  if (mode === 'off') return { state: 'off', reason: 'не заданы TALLY_DB_HOST, TALLY_DB_NAME, TALLY_READER_PASSWORD в .env' }
  if (mode === 'error') return { state: 'error', error: 'connect ETIMEDOUT 100.64.0.1:5432' }
  return null
}

function rows(filter: StatsFilter): { day: string; project: string; cost: number; sessions: number; limit: number }[] {
  const today = localDay(new Date())
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
      list.push({ day, project: profile.project, cost, sessions, limit: Number((cost * 0.11).toFixed(3)) })
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
    data: { at: new Date().toISOString(), accounts: ['global', 'work'], baton: BATON, projects, days, cells },
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
    tasks: Math.round(within.filter((row) => BATON.includes(row.project)).length / 3),
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
    if (!BATON.includes(project)) continue
    const count = Math.max(1, Math.min(40, Math.round(cost / 25)))
    for (let index = 0; index < count; index++) {
      const sessions = 1 + Math.floor(next() * 5)
      tasks.push({
        task: `${project}-${100 - index * 3}`,
        project,
        title: TITLES[(index + project.length) % TITLES.length]!,
        status: index === 0 ? 'In Progress' : 'Done',
        cost: (cost / count) * (0.3 + next() * 1.4),
        limit: (cost / count) * 0.11,
        sessions,
        relays: next() > 0.8 ? 1 : 0,
        checkpoints: sessions > 3 ? sessions - 2 : 0,
        restarts: next() > 0.9 ? 1 : 0,
        spans: next() > 0.7 ? 1 + Math.floor(next() * 3) : 0,
        rework: next() > 0.9,
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
      return stuckSpan(index + 1, BATON.includes(project) ? `${project}-${90 + index}` : null, project, day, next)
    })

  return {
    state: 'ok',
    data: {
      query,
      at: new Date().toISOString(),
      current,
      previous: totals(list, previousRange(range)),
      models: share(current.cost, [['opus', 0.62], ['sonnet', 0.31], ['haiku', 0.05], ['other', 0.02]]),
      entrypoints: share(current.cost, query.scope === 'chain' ? [['baton', 1]] : [['baton', 0.48], ['vscode', 0.3], ['desktop', 0.12], ['cli', 0.08], ['tally-classify', 0.02]]),
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
    }
  })
  const spans = sessions
    .filter(() => next() > 0.5)
    .map((session, index) => {
      const span = stuckSpan(index + 1, task, project, session.firstAt.slice(0, 10), next)
      const from = Date.parse(session.firstAt) + (Date.parse(session.lastAt) - Date.parse(session.firstAt)) * 0.3
      return { ...span, sessionId: session.sessionId, fromAt: new Date(from).toISOString(), toAt: new Date(from + 25 * 60_000).toISOString() }
    })
  return { state: 'ok', data: { task, sessions, spans } }
}
