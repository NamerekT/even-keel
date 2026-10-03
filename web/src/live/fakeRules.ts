import type { StatsAnswer } from '../../../src/stats/model.js'
import { lineDiff } from '../../../src/stats/diff.js'
import type { CompareQuery, CompareSide, RuleDiffFile, RuleKind, RuleMark, RuleSet, RulesQuery, StatsCompare, StatsRules } from '../../../src/stats/rules.js'
import type { ImportPrecision, RuleNote, RulePurpose } from '../../../src/stats/rule-imports.js'
import { failure } from './fakeStats.js'

const COMPARE = { minTasks: 5, minSessions: 10, days: 7 }
const DAY = 86_400_000

interface FakeFile {
  display: string
  kind: RuleKind
  project: string | null
  before: string
  after: string
  diff: boolean
}

interface FakeNote {
  purpose: RulePurpose[]
  reason: string
  precision?: ImportPrecision
  driftHours?: number
  summaries?: string[]
}

interface FakeSet {
  daysAgo: number
  hour: number
  task: string | null
  title: string | null
  files: FakeFile[]
  note?: FakeNote
  imported?: boolean
}

const RULES = ['# Правила', '', '- Отвечать кратко.', '- Код и комментарии — на английском.', '- Временные файлы — в `.temp/`.', '- Базовая ветка: `main`.']

const text = (lines: string[]) => lines.join('\n')
const file = (display: string, kind: RuleKind, project: string | null, before: string[], after: string[], diff = true): FakeFile => ({
  display,
  kind,
  project,
  before: text(before),
  after: text(after),
  diff,
})

// Marks in the fake are fixed: sets close together in time already share one mark.
const MARKS: FakeSet[][] = [
  [
    {
      daysAgo: 2,
      hour: 14,
      task: 'ABC-97',
      title: 'Тёмная тема для настроек',
      files: [file('~/.claude/CLAUDE.md', 'claude_md', null, RULES, [...RULES.slice(0, 3), '- Перед правкой читать файл целиком только по нужде.', ...RULES.slice(3)])],
      note: { purpose: ['economy'], reason: 'Сессии читали файлы целиком и перечитывали их — контекст рос без пользы' },
    },
  ],
  [
    {
      daysAgo: 4,
      hour: 9,
      task: null,
      title: null,
      imported: true,
      files: [file('~/.githooks/pre-push', 'hook', null, [], [], false), file('~/.claude.json', 'settings', null, [], [], false)],
      note: {
        purpose: ['infra'],
        reason: 'Пуш без проверки ветки уходил в чужой remote',
        precision: 'hour',
        summaries: ['Проверка ветки перед пушем', 'MCP-сервер трекера — только в своём проекте'],
      },
    },
  ],
  [
    {
      daysAgo: 6,
      hour: 10,
      task: null,
      title: null,
      files: [
        file(
          '~/.claude/skills/coding/SKILL.md',
          'skill',
          null,
          ['# Coding', '', '1. Сначала тест.', '2. Потом код.', '3. Потом сборка.'],
          ['# Coding', '', '1. Сначала падающий тест.', '2. Минимальный код.', '3. Граничные случаи — отдельными тестами.', '4. Потом сборка.'],
        ),
      ],
      note: { purpose: ['quality', 'process'], reason: 'Фиксы без теста возвращались переделкой', driftHours: 5 },
    },
    {
      daysAgo: 6,
      hour: 11,
      task: 'DEMO-41',
      title: 'Склад без лишних полок',
      files: [
        file('D:/Projects/demo/CLAUDE.md', 'claude_md', 'DEMO', ['# Demo', '', 'Тесты: `npm test`.'], ['# Demo', '', 'Тесты: `npm test`, сборка: `npm run build`.', 'Скриншоты — в `.temp/`.']),
      ],
    },
  ],
  [
    {
      daysAgo: 12,
      hour: 16,
      task: null,
      title: 'Хук контрольной точки',
      files: [file('~/.claude/hooks/context-checkpoint.mjs', 'hook', null, [], [], false)],
      note: { purpose: ['economy'], reason: 'Раздутый контекст дорожал к концу длинных задач' },
    },
  ],
  [
    {
      daysAgo: 18,
      hour: 9,
      task: null,
      title: null,
      files: [file('~/.claude/settings.json', 'settings', null, ['{', '  "model": "opus"', '}'], ['{', '  "model": "sonnet"', '}'])],
    },
  ],
  [
    {
      daysAgo: 24,
      hour: 13,
      task: 'OPS-12',
      title: 'Отчёт о расходе по неделям',
      files: [file('~/.claude/agents/reviewer.md', 'agent', null, [], ['# Reviewer', '', 'Проверяет дифф ветки и пишет замечания.'])],
    },
  ],
  [
    {
      daysAgo: 40,
      hour: 20,
      task: null,
      title: null,
      files: [file('~/.claude/skills/huly-tracker/SKILL.md#description', 'skill', null, ['Task tracking in Huly.'], ['Task tracking in Huly: day-to-day workflow and onboarding.'])],
    },
  ],
]

const hex = (seed: number) => (seed * 2_654_435_761 >>> 0).toString(16).padStart(8, '0').repeat(5)
const sessionOf = (index: number) => `00000000-0000-4000-a000-${String(index).padStart(12, '0')}`

function momentOf(set: FakeSet, minutes = 0): string {
  const day = new Date(Date.now() - set.daysAgo * DAY)
  day.setHours(set.hour, 10 + minutes, 0, 0)
  return day.toISOString()
}

function noteOf(set: FakeSet): RuleNote | null {
  if (set.note === undefined) return null
  const { purpose, reason, precision = 'exact', driftHours, summaries = [] } = set.note
  return {
    importId: String(set.daysAgo),
    at: momentOf(set, -25),
    until: momentOf(set),
    precision,
    purpose,
    reason,
    task: set.task,
    files: set.files.map((each, index) => ({ path: each.display, action: 'changed', summary: summaries[index] ?? '', precision: null, at: null })),
    drift: driftHours === undefined ? null : driftHours * 3_600_000,
  }
}

function changes(): Map<string, FakeFile> {
  const map = new Map<string, FakeFile>()
  let seed = 1
  for (const sets of MARKS) for (const set of sets) for (const each of set.files) map.set(hex(seed++), each)
  return map
}

export function fakeRules(mode: string | null, rules: string | null, query: RulesQuery): StatsAnswer<StatsRules> {
  const failed = failure<StatsRules>(mode)
  if (failed !== null) return failed
  const ids = [...changes().keys()]
  let seed = 0
  let session = 0
  const marks: RuleMark[] = []
  for (const group of rules === 'empty' ? [] : MARKS) {
    const sets: RuleSet[] = []
    for (const set of group) {
      session++
      const files = set.files
        .map((each) => ({ each, id: ids[seed++]! }))
        .filter(({ each }) => query.kinds === null || query.kinds.includes(each.kind))
        .filter(({ each }) => each.project === null || query.projects === null || query.projects.includes(each.project))
        .map(({ each, id }) => {
          const diff = lineDiff(each.before, each.after)
          return {
            key: each.display.toLowerCase(),
            display: each.display,
            kind: each.kind,
            project: each.project,
            added: each.diff ? diff.added : 14,
            removed: each.diff ? diff.removed : 3,
            changes: each.diff ? [id] : [],
          }
        })
      if (files.length === 0) continue
      const note = noteOf(set)
      if (query.purposes !== null && !(note?.purpose ?? []).some((purpose) => query.purposes!.includes(purpose))) continue
      const manual = set.task === null && set.title === null
      const id = set.imported ? `i:${session}` : manual ? `m:${files[0]!.changes[0] ?? hex(seed)}` : `s:${sessionOf(session)}`
      sets.push({ id, startAt: momentOf(set, -25), at: momentOf(set), sessionId: manual ? null : sessionOf(session), task: set.task, title: set.title, files, note })
    }
    if (sets.length > 0) marks.push({ fromAt: sets[0]!.startAt, toAt: sets.at(-1)!.at, sets })
  }
  return { state: 'ok', data: { at: new Date().toISOString(), marks: marks.reverse(), compare: COMPARE } }
}

export function fakeRuleDiff(mode: string | null, ids: string[]): StatsAnswer<RuleDiffFile[]> {
  const failed = failure<RuleDiffFile[]>(mode)
  if (failed !== null) return failed
  const known = changes()
  const files = ids.flatMap((id) => {
    const each = known.get(id)
    if (each === undefined) return []
    const at = new Date().toISOString()
    return [{ key: each.display.toLowerCase(), display: each.display, kind: each.kind, fromAt: at, toAt: at, ...lineDiff(each.before || null, each.after) }]
  })
  return { state: 'ok', data: files }
}

export function fakeCompare(mode: string | null, rules: string | null, query: CompareQuery): StatsAnswer<StatsCompare> {
  const failed = failure<StatsCompare>(mode)
  if (failed !== null) return failed
  const days = query.days ?? COMPARE.days
  const thin = rules === 'thin'
  const scale = days / 7
  const side = (
    from: number,
    to: number,
    [tasks, sessions, taskCost, stuck, errors, entry]: [number, number, number, number, number, number],
    [context, over150, perRequest]: [number, number, number],
    models: CompareSide['models'],
  ): CompareSide => ({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    tasks: thin ? 3 : Math.round(tasks * scale),
    sessions: thin ? 6 : Math.round(sessions * scale),
    taskCost: thin ? null : taskCost,
    sessionsPerTask: thin ? null : sessions / tasks,
    stuckShare: thin ? null : stuck,
    errorShare: thin ? null : errors,
    deniedShare: thin ? null : errors / 6,
    entryTokens: thin ? null : entry,
    requests: thin ? 140 : Math.round(sessions * 38 * scale),
    meanContext: thin ? null : context,
    over150Share: thin ? null : over150,
    requestCost: thin ? null : perRequest,
    models,
  })
  const before = Date.parse(query.before)
  const after = Date.parse(query.after)
  return {
    state: 'ok',
    data: {
      days,
      thin,
      modelShift: true,
      minTasks: COMPARE.minTasks,
      minSessions: COMPARE.minSessions,
      before: side(before - days * DAY, before, [9, 21, 7.4, 0.16, 0.052, 41_200], [168_000, 0.49, 0.124], [
        { model: 'claude-opus-5', share: 0.78 },
        { model: 'claude-opus-5-5', share: 0.19 },
        { model: 'claude-sonnet-5', share: 0.03 },
      ]),
      after: side(after, Math.min(after + days * DAY, Date.now()), [11, 19, 6.1, 0.11, 0.038, 43_900], [131_000, 0.33, 0.104], [{ model: 'claude-opus-5-5', share: 1 }]),
    },
  }
}
