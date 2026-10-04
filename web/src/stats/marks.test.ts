import { describe, expect, it } from 'vitest'
import type { RuleKind, RuleMark } from '../../../src/stats/rules.js'
import { driftText, fileLabel, markKey, markPlaces, markSummary, markTitle, pickMark, pickedSpan, precisionText, setTitle, shortPath, toggleChip } from './marks.js'

const mark = (id: string, fromAt: string, toAt = fromAt): RuleMark => ({
  fromAt,
  toAt,
  sets: [{ id, startAt: fromAt, at: toAt, sessionId: null, task: null, title: null, files: [], note: null }],
})

describe('markPlaces', () => {
  const marks = [mark('a', '2026-09-01T12:00:00Z'), mark('b', '2026-09-09T12:00:00Z', '2026-09-10T12:00:00Z'), mark('c', '2026-10-20T12:00:00Z')]

  it('puts a mark in the day column of its last change', () => {
    const places = markPlaces(marks, { from: '2026-09-01', to: '2026-09-30' }, 'day')
    expect([...places.keys()]).toEqual(['2026-09-01', '2026-09-10'])
    expect(places.get('2026-09-10')).toEqual([{ mark: marks[1], offset: 0.5 }])
  })

  it('places a mark inside a week by its weekday', () => {
    const places = markPlaces(marks, { from: '2026-09-01', to: '2026-09-30' }, 'week')
    expect(places.get('2026-08-31')).toEqual([{ mark: marks[0], offset: 1.5 / 7 }])
    expect(places.get('2026-09-07')).toEqual([{ mark: marks[1], offset: 3.5 / 7 }])
  })

  it('skips marks outside the range', () => {
    expect(markPlaces(marks, { from: '2026-09-02', to: '2026-09-08' }, 'day').size).toBe(0)
  })
})

describe('pickMark', () => {
  it('picks one mark and drops it on a second click', () => {
    expect(pickMark([], 'a', false)).toEqual(['a'])
    expect(pickMark(['b'], 'a', false)).toEqual(['a'])
    expect(pickMark(['a'], 'a', false)).toEqual([])
    expect(pickMark(['a', 'b'], 'a', false)).toEqual(['a'])
  })

  it('adds a second mark with a modifier and replaces the second one after that', () => {
    expect(pickMark([], 'a', true)).toEqual(['a'])
    expect(pickMark(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(pickMark(['a', 'b'], 'c', true)).toEqual(['a', 'c'])
    expect(pickMark(['a', 'b'], 'b', true)).toEqual(['a'])
    expect(pickMark(['a', 'b'], 'a', true)).toEqual(['b'])
  })
})

describe('pickedSpan', () => {
  const marks = [mark('a', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z'), mark('b', '2026-09-05T10:00:00Z'), mark('c', '2026-09-09T10:00:00Z', '2026-09-09T12:00:00Z')]

  it('compares around one mark', () => {
    expect(pickedSpan(marks, ['a'])).toEqual({ before: '2026-09-01T10:00:00Z', after: '2026-09-01T11:00:00Z', marks: [marks[0]] })
  })

  it('compares from the earlier mark to the later one with everything between', () => {
    expect(pickedSpan(marks, ['c', 'a'])).toEqual({ before: '2026-09-01T10:00:00Z', after: '2026-09-09T12:00:00Z', marks })
  })

  it('forgets marks that are gone', () => {
    expect(pickedSpan(marks, ['x'])).toBeNull()
    expect(pickedSpan(marks, ['x', 'b'])).toEqual({ before: '2026-09-05T10:00:00Z', after: '2026-09-05T10:00:00Z', marks: [marks[1]] })
  })

  it('keys a mark by its first set', () => {
    expect(markKey(marks[2]!)).toBe('c')
  })
})

describe('shortPath', () => {
  it('keeps the last three segments of a long path', () => {
    expect(shortPath('~/.claude/CLAUDE.md')).toBe('~/.claude/CLAUDE.md')
    expect(shortPath('~/.claude/skills/coding/SKILL.md')).toBe('…/skills/coding/SKILL.md')
    expect(shortPath('D:/Projects/git/private/EvenKeel/CLAUDE.md')).toBe('…/private/EvenKeel/CLAUDE.md')
  })
})

describe('fileLabel', () => {
  it('drops the shared ~/.claude/ prefix of global files', () => {
    expect(fileLabel('~/.claude/CLAUDE.md')).toBe('CLAUDE.md')
    expect(fileLabel('~/.claude/skills/coding/SKILL.md')).toBe('skills/coding/SKILL.md')
    expect(fileLabel('~/.claude.json')).toBe('~/.claude.json')
    expect(fileLabel('~/.githooks/pre-push')).toBe('~/.githooks/pre-push')
  })

  it('keeps the project folder and what lies under its .claude', () => {
    expect(fileLabel('D:/Projects/Game/.claude/settings.local.json')).toBe('Game/.claude/settings.local.json')
    expect(fileLabel('D:/Projects/git/private/EvenKeel/CLAUDE.md')).toBe('EvenKeel/CLAUDE.md')
    expect(fileLabel('D:/Projects/git/private/EvenKeel/tally/CLAUDE.md')).toBe('tally/CLAUDE.md')
    expect(fileLabel('CLAUDE.md')).toBe('CLAUDE.md')
  })
})

describe('markSummary', () => {
  const base = mark('s:1', '2026-09-01T12:00:00Z').sets[0]!
  const file = (key: string, kind: RuleKind, added = 1, removed = 0) => ({ key, display: key, kind, project: null, added, removed, changes: [] })
  const note = (reason: string) => ({ importId: '1', at: base.at, until: null, precision: 'exact' as const, purpose: [], reason, task: null, files: [], drift: null })

  it('counts distinct files by kind in the chip order and sums the lines', () => {
    const summary = markSummary({
      fromAt: base.at,
      toAt: base.at,
      sets: [
        { ...base, files: [file('b', 'skill', 3, 1), file('a', 'claude_md')] },
        { ...base, id: 's:2', files: [file('a', 'claude_md', 2, 2), file('c', 'skill'), file('d', 'settings')] },
      ],
    })
    expect(summary.kinds).toBe('CLAUDE.md, навыки ×2, настройки')
    expect(summary.files).toBe(4)
    expect([summary.added, summary.removed]).toEqual([8, 3])
  })

  it('names tasks first, then sessions in quotes, then edits by hand, without repeats', () => {
    const summary = markSummary({
      fromAt: base.at,
      toAt: base.at,
      sets: [base, { ...base, sessionId: 'x', title: 'Audit' }, { ...base, task: 'A-2', title: 'A-2' }, { ...base, task: 'A-1' }, { ...base, task: 'A-2' }],
    })
    expect(summary.who).toEqual(['A-2', 'A-1', '«Audit»', 'вручную'])
  })

  it('keeps each journal reason once', () => {
    const summary = markSummary({ fromAt: base.at, toAt: base.at, sets: [{ ...base, note: note('Less context') }, { ...base, note: note('Less context') }, { ...base, note: note('') }, base] })
    expect(summary.reasons).toEqual(['Less context'])
  })
})

describe('toggleChip', () => {
  const all = ['a', 'b', 'c'] as const

  it('keeps all but the clicked one when everything is on', () => {
    expect(toggleChip(null, 'b', all)).toEqual(['a', 'c'])
  })

  it('turns a chip back on and returns to "all" once every chip is on', () => {
    expect(toggleChip(['a'], 'c', all)).toEqual(['a', 'c'])
    expect(toggleChip(['a', 'c'], 'b', all)).toBeNull()
  })

  it('turns a chip off and keeps the order of the full list', () => {
    expect(toggleChip(['c', 'a'], 'c', all)).toEqual(['a'])
    expect(toggleChip(['b'], 'b', all)).toEqual([])
  })
})

describe('driftText', () => {
  it('says how far the transcript is from the import', () => {
    expect(driftText(5 * 3_600_000)).toBe('в транскрипте на 5 ч позже')
    expect(driftText(-90 * 60_000)).toBe('в транскрипте на 2 ч раньше')
    expect(driftText(-40 * 60_000)).toBe('в транскрипте на 40 мин раньше')
    expect(driftText(3 * 86_400_000)).toBe('в транскрипте на 3 дн позже')
  })

  it('says nothing without a drift', () => {
    expect(driftText(null)).toBeNull()
    expect(driftText(0)).toBeNull()
  })
})

describe('precisionText', () => {
  it('marks only rough times', () => {
    expect(precisionText('exact')).toBeNull()
    expect(precisionText('hour')).toBe('±час')
    expect(precisionText('day')).toBe('±день')
  })
})

describe('setTitle', () => {
  const set = mark('s:1', '2026-09-01T12:00:00Z').sets[0]!

  it('prefers the task, then the session title, then says it was by hand', () => {
    expect(setTitle({ ...set, task: 'ABC-1', title: 'Fix' })).toBe('ABC-1')
    expect(setTitle({ ...set, title: 'Fix', sessionId: 'x' })).toBe('Fix')
    expect(setTitle({ ...set, sessionId: 'x' })).toBe('сессия без задачи')
    expect(setTitle(set)).toBe('вручную')
    expect(setTitle({ ...set, id: 'i:4' })).toBe('из импорта')
  })

  it('names a mark by its sets without repeats', () => {
    expect(markTitle({ fromAt: set.at, toAt: set.at, sets: [{ ...set, task: 'A-1' }, { ...set, task: 'A-1' }, set] })).toBe('A-1, вручную')
  })
})
