import { describe, expect, it } from 'vitest'
import type { TaskSession } from '../chain/launches.js'
import type { EventEntry } from '../event-log/model.js'
import type { SessionView } from '../state.js'
import { EVENT_LOG_SHOWN, HISTORY_SHOWN_MS, recentHistory, type HistoryInput } from './page-history.js'

const NOW = new Date('2026-11-17T12:00:00Z')
const old = new Date(NOW.getTime() - HISTORY_SHOWN_MS - 60_000).toISOString()
const fresh = new Date(NOW.getTime() - 60_000).toISOString()

const session = (task: string, sessionId: string, lamp: SessionView['lamp'], at: string) =>
  ({ task, sessionId, lamp, startedAt: at, lastActivityAt: at }) as SessionView
const run = (sessionId: string, at: string): TaskSession => ({ sessionId, at, how: 'launch', resumed: 0, answers: 0 })
const task = (id: string, category: string) => ({ id, status: { name: category, category } }) as HistoryInput['tasks'][number]

const input = (over: Partial<HistoryInput>): HistoryInput => ({ sessions: [], taskSessions: {}, eventLog: [], tasks: [], fixes: {}, current: [], ...over })

describe('recentHistory', () => {
  it('leaves out the finished sessions and the runs of a closed task that last moved before the window', () => {
    const history = recentHistory(
      input({
        sessions: [session('ABC-1', 's1', 'finished', old), session('ABC-2', 's2', 'finished', fresh)],
        taskSessions: { 'ABC-1': [run('s1', old)], 'ABC-2': [run('s2', fresh)] },
        tasks: [task('ABC-1', 'Won'), task('ABC-2', 'Won')],
      }),
      NOW,
    )
    expect(history.sessions.map((each) => each.sessionId)).toEqual(['s2'])
    expect(Object.keys(history.taskSessions)).toEqual(['ABC-2'])
    expect(history.ranAt).toEqual({ 'ABC-1': old })
  })

  it('keeps a live session, one the chain waits on and the history of an open task whatever their age', () => {
    const history = recentHistory(
      input({
        sessions: [session('ABC-1', 's1', 'waiting', old), session('ABC-2', 's2', 'finished', old), session('ABC-3', 's3', 'finished', old)],
        taskSessions: { 'ABC-3': [run('s3', old)], 'ABC-FIX.1': [run('s4', old)] },
        tasks: [task('ABC-1', 'Won'), task('ABC-2', 'Won'), task('ABC-3', 'Started')],
        fixes: { p: [{ id: 'ABC-FIX.1', red: null, at: old, end: null }] },
        current: ['s2'],
      }),
      NOW,
    )
    expect(history.sessions.map((each) => each.sessionId)).toEqual(['s1', 's2', 's3'])
    expect(Object.keys(history.taskSessions)).toEqual(['ABC-3', 'ABC-FIX.1'])
    expect(history.ranAt).toEqual({})
  })

  it('takes the last movement of a run, not its start', () => {
    const replaced: TaskSession = { ...run('s1', old), replaced: { at: fresh, how: 'restart' } }
    const history = recentHistory(input({ taskSessions: { 'ABC-1': [replaced] }, tasks: [task('ABC-1', 'Won')] }), NOW)
    expect(history.taskSessions).toEqual({ 'ABC-1': [replaced] })
  })

  it('keeps the runs of a task whose session stays', () => {
    const history = recentHistory(
      input({ sessions: [session('ABC-1', 's1', 'working', old)], taskSessions: { 'ABC-1': [run('s1', old)] }, tasks: [task('ABC-1', 'Won')] }),
      NOW,
    )
    expect(Object.keys(history.taskSessions)).toEqual(['ABC-1'])
  })

  it('carries only the newest entries of the event log', () => {
    const entries = Array.from({ length: EVENT_LOG_SHOWN + 5 }, (_, index): EventEntry => ({ id: String(index + 1), at: fresh, level: 'info', notice: { code: 'eventLog.limit', params: {} }, place: null }))
    const history = recentHistory(input({ eventLog: entries }), NOW)
    expect(history.eventLog).toHaveLength(EVENT_LOG_SHOWN)
    expect(history.eventLog[0]!.id).toBe('6')
    expect(history.eventLog.at(-1)!.id).toBe(String(EVENT_LOG_SHOWN + 5))
  })
})
