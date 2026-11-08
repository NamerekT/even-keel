import { describe, expect, it } from 'vitest'
import type { EventEntry, EventLevel, EventPlace } from '../../../src/event-log/model.js'
import { en } from '../../../src/notice/en.js'
import { englishOf, notice, renderNotice, type Notice } from '../../../src/notice/notice.js'
import { noticesRu } from '../i18n/notices-ru.js'
import { fakeEventLog } from '../live/fakeEvents.js'
import { categoryOf, filtered, filterOf, projectOf, searchOf, subjectOf, type EventFilter } from './eventLogFilter.js'

const all: EventFilter = { level: null, category: null, project: null }
const entry = (message: Notice, place: EventPlace | null = null, level: EventLevel = 'info'): EventEntry => ({
  id: '1', at: '2026-11-07T10:00:00.000Z', level, notice: message, place,
})

describe('event categories', () => {
  it('classifies every eventLog code explicitly', () => {
    for (const code of Object.keys(en).filter((key) => key.startsWith('eventLog.'))) {
      expect(categoryOf({ code, params: {} } as Notice), code).not.toBe('system')
    }
  })

  it.each([
    ['eventLog.launch', 'sessions'], ['eventLog.unmerged', 'sessions'],
    ['eventLog.chainHeld', 'chain'], ['eventLog.conflict', 'chain'],
    ['eventLog.ask', 'questions'], ['eventLog.ciRed', 'main'],
    ['eventLog.usageOff', 'limits'], ['eventLog.packages', 'packages'],
    ['eventLog.projectRemoved', 'settings'], ['eventLog.settings', 'settings'],
    ['agent.uncheckedVersion', 'system'], ['text', 'system'],
  ])('%s belongs to %s', (code, category) => {
    expect(categoryOf({ code, params: {} } as Notice)).toBe(category)
  })

  it('has fake entries for every category and two projects', () => {
    const entries = fakeEventLog(['p-1', 'p-2'])
    expect(new Set(entries.map(categoryOfEntry))).toEqual(new Set(['sessions', 'chain', 'questions', 'main', 'limits', 'packages', 'settings', 'system']))
    expect(new Set(entries.map(projectOf))).toEqual(new Set(['p-1', 'p-2', null]))
  })
})

function categoryOfEntry(entry: EventEntry) { return categoryOf(entry.notice) }

describe('event projects', () => {
  it('prefers the place project over notice parameters', () => {
    expect(projectOf(entry(notice('eventLog.red', { project: 'p-2', commit: 'abc', cis: [] }), { view: 'ci', project: 'p-1' }))).toBe('p-1')
  })

  it('falls back to a string parameter for a null or missing place project', () => {
    const message = notice('eventLog.projectSettings', { project: 'p-2' })
    expect(projectOf(entry(message, { view: 'ask', project: null, task: 'ABC-1' }))).toBe('p-2')
    expect(projectOf(entry(message))).toBe('p-2')
    expect(projectOf(entry(message, { view: 'accounts' }))).toBe('p-2')
  })

  it('never treats a removed project key or an account as a project id', () => {
    expect(projectOf(entry(notice('eventLog.projectRemoved', { key: 'ABC' })))).toBeNull()
    expect(projectOf(entry(notice('eventLog.usageUnread', { account: 'global' }), { view: 'accounts' }))).toBeNull()
    expect(projectOf(entry({ code: 'text', params: { project: 12 } } as unknown as Notice))).toBeNull()
  })
})

describe('event filter URLs', () => {
  it('round trips each field and all fields', () => {
    for (const filter of [all, { ...all, level: 'warning' as const }, { ...all, category: 'system' as const }, { ...all, project: 'p 1' },
      { level: 'error', category: 'main', project: 'p-2' } as const]) {
      expect(filterOf(searchOf(filter))).toEqual(filter)
    }
    expect(searchOf(all).toString()).toBe('')
  })

  it('ignores unknown and empty levels and categories', () => {
    expect(filterOf(new URLSearchParams('level=foo&category=bar'))).toEqual(all)
    expect(filterOf(new URLSearchParams('level=&category=&project='))).toEqual(all)
  })

  it('takes the first repeated value', () => {
    expect(filterOf(new URLSearchParams('level=warning&level=error'))).toEqual({ ...all, level: 'warning' })
  })

  it('reads an old info level as all levels', () => {
    expect(filterOf(new URLSearchParams('level=info'))).toEqual(all)
  })
})

describe('event subjects', () => {
  it('names the task of a task entry with the project of its place', () => {
    expect(subjectOf(entry(notice('eventLog.ask', { task: 'ABC-4' }), { view: 'ask', project: 'p-1', task: 'ABC-4' }))).toEqual({ task: 'ABC-4', project: 'p-1' })
    expect(subjectOf(entry(notice('eventLog.stopped', { task: 'ABC-2' }), { view: 'project', project: 'p-1' }))).toEqual({ task: 'ABC-2', project: 'p-1' })
    expect(subjectOf(entry(notice('eventLog.launch', { task: 'ABC-1' })))).toEqual({ task: 'ABC-1', project: null })
  })

  it('names the project of a project entry, and the key of a removed one', () => {
    expect(subjectOf(entry(notice('eventLog.red', { project: 'p-2', commit: 'abc', cis: [] }), { view: 'ci', project: 'p-2' }))).toEqual({ project: 'p-2' })
    expect(subjectOf(entry(notice('eventLog.projectSettings', { project: 'p-2' }), { view: 'settings', project: 'p-2' }))).toEqual({ project: 'p-2' })
    expect(subjectOf(entry(notice('eventLog.projectRemoved', { key: 'ABC' })))).toEqual({ key: 'ABC' })
  })

  it('has none for entries about neither, nor for messages whose text names their project itself', () => {
    expect(subjectOf(entry(notice('eventLog.settings', {}), { view: 'settings', project: null }))).toBeNull()
    expect(subjectOf(entry(notice('eventLog.usageUnread', { account: 'global' }), { view: 'accounts' }))).toBeNull()
    expect(subjectOf(entry(notice('chain.empty', { project: 'p-1' }), { view: 'project', project: 'p-1' }))).toBeNull()
  })

  it('leaves the subject out of every eventLog text', () => {
    const params = { task: 'T-9', project: 'P-9', key: 'K-9', commit: 'c1', cis: ['github'], into: 'dev', path: '/w', problem: 'noKey', detail: 'KEY', account: 'a' }
    for (const code of Object.keys(en).filter((key) => key.startsWith('eventLog.'))) {
      const message = { code, params } as unknown as Notice
      for (const text of [englishOf(message), renderNotice(message, noticesRu)]) expect(text, code).not.toMatch(/T-9|P-9|K-9/)
    }
  })
})

describe('filtered events', () => {
  const first = entry(notice('eventLog.launch', { task: 'ABC-1' }), { view: 'project', project: 'p-1' })
  const second = entry(notice('eventLog.red', { project: 'p-2', commit: 'abc', cis: [] }), null, 'error')
  const third = entry(notice('eventLog.usageUnread', { account: 'global' }), { view: 'accounts' }, 'warning')
  const entries = [first, second, third]

  it('preserves order without mutating the input', () => {
    expect(filtered(entries, all)).toEqual(entries)
    expect(filtered([], all)).toEqual([])
  })

  it('takes a level as the lowest one shown', () => {
    expect(filtered(entries, { ...all, level: 'warning' })).toEqual([second, third])
    expect(filtered(entries, { ...all, level: 'error' })).toEqual([second])
  })

  it('filters by each field separately', () => {
    expect(filtered(entries, { ...all, category: 'sessions' })).toEqual([first])
    expect(filtered(entries, { ...all, project: 'p-2' })).toEqual([second])
    expect(filtered(entries, { ...all, project: 'p-1' })).not.toContain(third)
  })

  it('requires all selected fields to match', () => {
    expect(filtered(entries, { level: 'error', category: 'main', project: 'p-2' })).toEqual([second])
    expect(filtered(entries, { level: 'error', category: 'sessions', project: 'p-1' })).toEqual([])
  })
})
