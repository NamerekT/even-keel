import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventEntry, EventLevel } from '../../../src/event-log/model.js'
import { notice } from '../../../src/notice/notice.js'
import { freshAlerts, lastId, markRead, placePath, readMark, TOAST_LIMIT, withFresh } from './eventLog.js'

const entry = (id: number, level: EventLevel): EventEntry => ({
  id: String(id),
  at: '2026-11-05T10:00:00.000Z',
  level,
  notice: notice('eventLog.settings', {}),
  place: null,
})

const state = { projects: ['p-1'], ci: {} }

describe('placePath', () => {
  it('opens the place of each view', () => {
    expect(placePath({ view: 'ask', project: 'p-1', task: 'ABC-4' }, state)).toEqual({ pathname: '/p/p-1', hash: 'ABC-4' })
    expect(placePath({ view: 'ask', project: null, task: 'ABC-4' }, state)).toEqual({ pathname: '/' })
    expect(placePath({ view: 'backlog', project: 'p-1' }, state)).toEqual({ pathname: '/p/p-1', hash: 'backlog' })
    expect(placePath({ view: 'task', project: 'p-1', task: 'ABC 5' }, state)).toEqual({ pathname: '/p/p-1', search: '?task=ABC%205' })
    expect(placePath({ view: 'settings', project: 'p-1' }, state)).toEqual({ pathname: '/p/p-1', hash: 'settings' })
    expect(placePath({ view: 'settings', project: null }, state)).toEqual({ pathname: '/settings' })
    expect(placePath({ view: 'project', project: 'p-1' }, state)).toEqual({ pathname: '/p/p-1' })
  })

  it('opens the CI chip only of a project that has one', () => {
    expect(placePath({ view: 'ci', project: 'p-1' }, state)).toEqual({ pathname: '/p/p-1' })
    expect(placePath({ view: 'ci', project: 'p-1' }, { ...state, ci: { 'p-1': [] } })).toEqual({ pathname: '/p/p-1', hash: 'ci' })
  })

  it('has nowhere to go without a place or for a project removed since', () => {
    expect(placePath(null, state)).toBeNull()
    expect(placePath({ view: 'project', project: 'p-gone' }, state)).toBeNull()
  })
})

describe('the alerts of the log', () => {
  const log = [entry(1, 'info'), entry(2, 'warning'), entry(3, 'error'), entry(4, 'info'), entry(10, 'warning')]

  it('counts only warnings and errors after the mark', () => {
    expect(lastId(log)).toBe(10)
    expect(lastId([])).toBe(0)
    expect(freshAlerts(log, 2).map((each) => each.id)).toEqual(['3', '10'])
    expect(freshAlerts(log, 0)).toHaveLength(3)
    expect(freshAlerts(log, 10)).toHaveLength(0)
  })

  it('keeps only the newest toasts', () => {
    const many = Array.from({ length: TOAST_LIMIT + 2 }, (_, index) => entry(index + 1, 'error'))
    expect(withFresh(many.slice(0, 2), many.slice(2)).map((each) => each.id)).toEqual(many.slice(-TOAST_LIMIT).map((each) => each.id))
  })
})

describe('the read mark', () => {
  beforeEach(() => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts unset and never moves back', () => {
    expect(readMark()).toBeNull()
    markRead(7)
    markRead(3)
    expect(readMark()).toBe(7)
  })
})
