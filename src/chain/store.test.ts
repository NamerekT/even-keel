import { describe, expect, it } from 'vitest'
import { emptyChainState, type ChainState } from './dispatcher.js'
import {
  appendLaunch,
  chainStateOf,
  closedTasks,
  loadChainState,
  loadQuestions,
  readLaunches,
  saveChainState,
  saveClosedTask,
  saveQuestions,
} from './store.js'
import { notice, textNotice } from '../notice/notice.js'
import { openDatabase } from '../storage/database.js'

const db = () => openDatabase(':memory:')

describe('chain store', () => {
  it('starts empty when nothing was saved', () => {
    expect(loadChainState(db())).toEqual(emptyChainState())
  })

  it('reads back what it saved', () => {
    const store = db()
    const state: ChainState = {
      active: [
        { project: 'ABC', current: { task: 'ABC-1', sessionId: 's1', since: 't' }, paused: true, error: null },
        { project: 'DEF', current: null, paused: false, error: null, limitUntil: 't' },
      ],
      queue: ['XYZ'],
      orders: { ABC: ['ABC-2', 'ABC-1'] },
      skipped: { ABC: ['ABC-3'] },
      leftovers: { ABC: [{ task: 'ABC-0', at: 't', notice: notice('cleanup.worktreeKept', { path: 'C:\\abc' }) }] },
      released: { ABC: ['ABC-4'] },
      unattended: true,
      trimTools: false,
      ci: { ABC: { green: 'abc123', check: { commit: 'def456', at: 't', tasks: ['ABC-5'] } } },
    }
    saveChainState(store, state)
    expect(loadChainState(store)).toEqual(state)
  })

  it('replaces the stored chain state whole', () => {
    const store = db()
    saveChainState(store, { ...emptyChainState(), queue: ['ABC'], orders: { ABC: ['ABC-1'] } })
    const next = { ...emptyChainState(), orders: { DEF: [] } }
    saveChainState(store, next)
    expect(loadChainState(store)).toEqual(next)
  })

  it('reads the single chain, the English pause reason and leftovers of an older file', () => {
    const active = { project: 'ABC', current: null, paused: true, error: 'chain: launch of ABC-1 failed' }
    const leftovers = { ABC: [{ task: 'ABC-0', at: 't', text: 'ABC-0: the worktree was kept' }] }
    const state = chainStateOf({ active, queue: [], orders: {}, leftovers }, {}, 'chain.json')
    expect(state.active).toMatchObject([{ project: 'ABC', paused: true }])
    expect(state.active[0]?.error).toEqual(textNotice('chain: launch of ABC-1 failed'))
    expect(state.leftovers).toEqual({ ABC: [{ task: 'ABC-0', at: 't', notice: textNotice('ABC-0: the worktree was kept') }] })
  })

  it('reads a file saved before tasks could be skipped or leave leftovers', () => {
    const state = chainStateOf({ active: null, queue: [], orders: {} }, {}, 'chain.json')
    expect(state).toEqual(emptyChainState())
    expect(state.trimTools).toBe(true)
  })

  it('forgets a session start the service did not live to finish', () => {
    const store = db()
    const current = { task: 'ABC-1', sessionId: 's1', since: 't', starting: 't' }
    saveChainState(store, { ...emptyChainState(), active: [{ project: 'ABC', current, paused: false, error: null }] })
    expect(loadChainState(store).active[0]?.current).toEqual({ task: 'ABC-1', sessionId: 's1', since: 't' })
  })

  it('keeps a transition of a running session the service did not live to finish, for the chain to see it through', () => {
    const store = db()
    const current = { task: 'ABC-1', sessionId: 's1', since: 't', starting: 't', move: 'answer' as const, answering: true, reply: 'Go', ask: 'toolu_1' }
    saveChainState(store, { ...emptyChainState(), active: [{ project: 'ABC', current, paused: false, error: null }] })
    expect(loadChainState(store).active[0]?.current).toEqual(current)
  })

  it('forgets a cut first launch even when it is marked as a move', () => {
    const store = db()
    const current = { task: 'ABC-1', sessionId: null, since: 't', starting: 't', move: 'restart' as const }
    saveChainState(store, { ...emptyChainState(), active: [{ project: 'ABC', current, paused: false, error: null }] })
    expect(loadChainState(store).active[0]?.current).toEqual({ task: 'ABC-1', sessionId: null, since: 't' })
  })

  it('refuses a damaged record instead of silently forgetting the chain', () => {
    expect(() => chainStateOf({ active: 5 }, {}, 'chain.json')).toThrow(/chain\.json/)
    expect(() => chainStateOf({ active: [{ project: 'ABC' }, 5], queue: [], orders: {} }, {}, 'chain.json')).toThrow(/chain\.json/)
  })

  it('appends launches and reads them back in order', () => {
    const store = db()
    expect(readLaunches(store)).toEqual([])
    const first = { at: '2026-09-26T10:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 's1' }
    const second = { at: '2026-09-26T11:00:00.000Z', project: 'ABC', task: 'ABC-2', sessionId: 's2', reason: 'handoff' as const, model: 'opus' }
    appendLaunch(store, first)
    appendLaunch(store, second)
    expect(readLaunches(store)).toEqual([first, second])
  })

  it('reads back the questions in order, with the answered ones marked', () => {
    const store = db()
    expect(loadQuestions(store)).toEqual([])
    const posted = [
      { task: 'ABC-1', sessionId: 's1', ask: 'a', comment: 'c' },
      { task: 'ABC-2', sessionId: 's2', ask: 'b', comment: 'd', done: true },
    ]
    saveQuestions(store, posted)
    expect(loadQuestions(store)).toEqual(posted)
    saveQuestions(store, posted.slice(1))
    expect(loadQuestions(store)).toEqual(posted.slice(1))
  })

  it('keeps one closed task per project and number, with the latest title and time', () => {
    const store = db()
    const ids = { ABC: 'id-abc' }
    const closed = { project: 'ABC', task: 'ABC-1', tracker: 'huly', title: 'First', url: null, closedAt: '2026-10-01T00:00:00.000Z' }
    saveClosedTask(store, closed, ids)
    saveClosedTask(store, { ...closed, task: 'ABC-2', closedAt: '2026-10-02T00:00:00.000Z' }, ids)
    saveClosedTask(store, { ...closed, title: 'Reopened', url: 'https://example.com/ABC-1', closedAt: '2026-10-03T00:00:00.000Z' }, ids)
    expect(closedTasks(store, ids)).toEqual([
      { ...closed, task: 'ABC-2', closedAt: '2026-10-02T00:00:00.000Z' },
      { ...closed, title: 'Reopened', url: 'https://example.com/ABC-1', closedAt: '2026-10-03T00:00:00.000Z' },
    ])
    expect(closedTasks(store).map((task) => task.project)).toEqual(['id-abc', 'id-abc'])
  })

  describe('projects by id in the database', () => {
    const ids = { ABC: 'id-abc', XYZ: 'id-xyz' }

    it('saves the chain under the ids and reads it back by key', () => {
      const store = db()
      const state: ChainState = {
        ...emptyChainState(),
        active: [{ project: 'ABC', current: null, paused: false, error: null }],
        queue: ['XYZ'],
        orders: { ABC: ['ABC-1'], XYZ: [] },
        ci: { XYZ: { green: 'abc123' } },
      }
      saveChainState(store, state, ids)
      expect(store.prepare('SELECT project_id FROM chains').all()).toEqual([{ project_id: 'id-abc' }])
      expect(store.prepare('SELECT project_id FROM chain_queue').all()).toEqual([{ project_id: 'id-xyz' }])
      expect(loadChainState(store).orders).toEqual({ 'id-abc': ['ABC-1'], 'id-xyz': [] })
      expect(loadChainState(store, ids)).toEqual(state)
    })

    it('keeps the id of a project the config no longer has', () => {
      const store = db()
      saveChainState(store, { ...emptyChainState(), orders: { 'id-gone': ['OLD-1'] } })
      expect(loadChainState(store, ids).orders).toEqual({ 'id-gone': ['OLD-1'] })
    })

    it('names projects by id in the launches', () => {
      const store = db()
      const entry = { at: 't', project: 'ABC', task: 'ABC-1', sessionId: 's1' }
      appendLaunch(store, entry, ids)
      appendLaunch(store, entry, ids)
      expect(readLaunches(store, ids)).toEqual([entry, entry])
      expect(readLaunches(store)).toEqual([
        { ...entry, project: 'id-abc' },
        { ...entry, project: 'id-abc' },
      ])
    })
  })
})
