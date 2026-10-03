import { describe, expect, it } from 'vitest'
import type { RuleMark } from '../../../src/stats/rules.js'
import { markKey, markPlaces, pickMark, pickedSpan, shortPath } from './marks.js'

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
    expect(shortPath('D:/Projects/git/private/Baton/CLAUDE.md')).toBe('…/private/Baton/CLAUDE.md')
  })
})
