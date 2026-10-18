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
import { mirrorDefinitions, putSettings } from '../settings/store.js'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'

const db = memoryDatabase

// The first database of a file migrates the template, which under a full run takes longer than the default 5 s.
describe('chain store', { timeout: 30_000 }, () => {
  it('starts empty when nothing was saved', async () => {
    expect(await loadChainState(await db())).toEqual(emptyChainState())
  })

  it('reads back what it saved', async () => {
    const store = await db()
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
      unattended: false,
      trimTools: true,
      ci: { ABC: { green: 'abc123', check: { commit: 'def456', at: 't', tasks: ['ABC-5'] } } },
    }
    await saveChainState(store, state)
    expect(await loadChainState(store)).toEqual(state)
  })

  it('reads the switches from the settings, not from what it saved', async () => {
    const store = await db()
    await saveChainState(store, { ...emptyChainState(), unattended: true, trimTools: false })
    expect(await loadChainState(store)).toMatchObject({ unattended: false, trimTools: true })
    await mirrorDefinitions(store)
    await putSettings(store, [{ key: 'unattended', project: null, qualifier: '', value: true }, { key: 'trimTools', project: null, qualifier: '', value: false }], 'page')
    expect(await loadChainState(store)).toMatchObject({ unattended: true, trimTools: false })
  })

  it('replaces the stored chain state whole', async () => {
    const store = await db()
    await saveChainState(store, { ...emptyChainState(), queue: ['ABC'], orders: { ABC: ['ABC-1'] } })
    const next = { ...emptyChainState(), orders: { DEF: [] } }
    await saveChainState(store, next)
    expect(await loadChainState(store)).toEqual(next)
  })

  it('keeps the order of saves nobody waited for', async () => {
    const store = await db()
    const writes = new Writes(() => {})
    const states = [1, 2, 3].map((n) => ({ ...emptyChainState(), queue: [`P${n}`] }))
    for (const state of states) writes.add('the chain state', saveChainState(store, state))
    writes.add('a launch', appendLaunch(store, { at: 't', project: 'P3', task: 'P3-1', sessionId: 's1' }))
    await writes.settled()
    expect(await loadChainState(store)).toEqual(states[2])
    expect(await readLaunches(store)).toHaveLength(1)
  })

  it('logs a write nobody waited for that failed', async () => {
    const lines: string[] = []
    const writes = new Writes((line) => lines.push(line))
    writes.add('the chain state', Promise.reject(new Error('disk full')))
    await writes.settled()
    expect(lines).toEqual(['storage: the chain state not saved: disk full'])
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

  it('forgets a session start the service did not live to finish', async () => {
    const store = await db()
    const current = { task: 'ABC-1', sessionId: 's1', since: 't', starting: 't' }
    await saveChainState(store, { ...emptyChainState(), active: [{ project: 'ABC', current, paused: false, error: null }] })
    expect((await loadChainState(store)).active[0]?.current).toEqual({ task: 'ABC-1', sessionId: 's1', since: 't' })
  })

  it('keeps a transition of a running session the service did not live to finish, for the chain to see it through', async () => {
    const store = await db()
    const current = { task: 'ABC-1', sessionId: 's1', since: 't', starting: 't', move: 'answer' as const, answering: true, reply: 'Go', ask: 'toolu_1' }
    await saveChainState(store, { ...emptyChainState(), active: [{ project: 'ABC', current, paused: false, error: null }] })
    expect((await loadChainState(store)).active[0]?.current).toEqual(current)
  })

  it('forgets a cut first launch even when it is marked as a move', async () => {
    const store = await db()
    const current = { task: 'ABC-1', sessionId: null, since: 't', starting: 't', move: 'restart' as const }
    await saveChainState(store, { ...emptyChainState(), active: [{ project: 'ABC', current, paused: false, error: null }] })
    expect((await loadChainState(store)).active[0]?.current).toEqual({ task: 'ABC-1', sessionId: null, since: 't' })
  })

  it('refuses a damaged record instead of silently forgetting the chain', () => {
    expect(() => chainStateOf({ active: 5 }, {}, 'chain.json')).toThrow(/chain\.json/)
    expect(() => chainStateOf({ active: [{ project: 'ABC' }, 5], queue: [], orders: {} }, {}, 'chain.json')).toThrow(/chain\.json/)
  })

  it('appends launches and reads them back in order', async () => {
    const store = await db()
    expect(await readLaunches(store)).toEqual([])
    const first = { at: '2026-09-26T10:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 's1' }
    const second = { at: '2026-09-26T11:00:00.000Z', project: 'ABC', task: 'ABC-2', sessionId: 's2', reason: 'handoff' as const, model: 'opus' }
    await appendLaunch(store, first)
    await appendLaunch(store, second)
    expect(await readLaunches(store)).toEqual([first, second])
  })

  it('reads back the questions in order, with the answered ones marked', async () => {
    const store = await db()
    expect(await loadQuestions(store)).toEqual([])
    const posted = [
      { task: 'ABC-1', sessionId: 's1', ask: 'a', comment: 'c' },
      { task: 'ABC-2', sessionId: 's2', ask: 'b', comment: 'd', done: true },
    ]
    await saveQuestions(store, posted)
    expect(await loadQuestions(store)).toEqual(posted)
    await saveQuestions(store, posted.slice(1))
    expect(await loadQuestions(store)).toEqual(posted.slice(1))
  })

  it('keeps one closed task per project and number, with the latest title and time', async () => {
    const store = await db()
    const ids = { ABC: 'id-abc' }
    const closed = { project: 'ABC', task: 'ABC-1', tracker: 'huly', title: 'First', url: null, closedAt: '2026-10-01T00:00:00.000Z' }
    await saveClosedTask(store, closed, ids)
    await saveClosedTask(store, { ...closed, task: 'ABC-2', closedAt: '2026-10-02T00:00:00.000Z' }, ids)
    await saveClosedTask(store, { ...closed, title: 'Reopened', url: 'https://example.com/ABC-1', closedAt: '2026-10-03T00:00:00.000Z' }, ids)
    expect(await closedTasks(store, ids)).toEqual([
      { ...closed, task: 'ABC-2', closedAt: '2026-10-02T00:00:00.000Z' },
      { ...closed, title: 'Reopened', url: 'https://example.com/ABC-1', closedAt: '2026-10-03T00:00:00.000Z' },
    ])
    expect((await closedTasks(store)).map((task) => task.project)).toEqual(['id-abc', 'id-abc'])
  })

  describe('projects by id in the database', () => {
    const ids = { ABC: 'id-abc', XYZ: 'id-xyz' }

    it('saves the chain under the ids and reads it back by key', async () => {
      const store = await db()
      const state: ChainState = {
        ...emptyChainState(),
        active: [{ project: 'ABC', current: null, paused: false, error: null }],
        queue: ['XYZ'],
        orders: { ABC: ['ABC-1'], XYZ: [] },
        ci: { XYZ: { green: 'abc123' } },
      }
      await saveChainState(store, state, ids)
      expect((await store.query('select project_id from chains')).rows).toEqual([{ project_id: 'id-abc' }])
      expect((await store.query('select project_id from chain_queue')).rows).toEqual([{ project_id: 'id-xyz' }])
      expect((await loadChainState(store)).orders).toEqual({ 'id-abc': ['ABC-1'], 'id-xyz': [] })
      expect(await loadChainState(store, ids)).toEqual(state)
    })

    it('keeps the id of a project the config no longer has', async () => {
      const store = await db()
      await saveChainState(store, { ...emptyChainState(), orders: { 'id-gone': ['OLD-1'] } })
      expect((await loadChainState(store, ids)).orders).toEqual({ 'id-gone': ['OLD-1'] })
    })

    it('names projects by id in the launches', async () => {
      const store = await db()
      const entry = { at: 't', project: 'ABC', task: 'ABC-1', sessionId: 's1' }
      await appendLaunch(store, entry, ids)
      await appendLaunch(store, entry, ids)
      expect(await readLaunches(store, ids)).toEqual([entry, entry])
      expect(await readLaunches(store)).toEqual([
        { ...entry, project: 'id-abc' },
        { ...entry, project: 'id-abc' },
      ])
    })
  })
})
