import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyChainState, type ChainState } from './dispatcher.js'
import { appendLaunch, loadChainState, loadQuestions, readLaunches, saveChainState, saveQuestions } from './store.js'
import { notice, textNotice } from '../notice/notice.js'

const dir = () => mkdtempSync(join(tmpdir(), 'even-keel-state-'))

describe('chain store', () => {
  it('starts empty when nothing was saved', () => {
    expect(loadChainState(join(dir(), 'nested', 'chain.json'))).toEqual(emptyChainState())
  })

  it('reads back what it saved', () => {
    const file = join(dir(), 'nested', 'chain.json')
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
    saveChainState(file, state)
    expect(loadChainState(file)).toEqual(state)
  })

  it('reads the single chain, the English pause reason and leftovers of an older file', () => {
    const file = join(dir(), 'chain.json')
    const active = { project: 'ABC', current: null, paused: true, error: 'chain: launch of ABC-1 failed' }
    const leftovers = { ABC: [{ task: 'ABC-0', at: 't', text: 'ABC-0: the worktree was kept' }] }
    writeFileSync(file, JSON.stringify({ active, queue: [], orders: {}, leftovers }))
    const state = loadChainState(file)
    expect(state.active).toMatchObject([{ project: 'ABC', paused: true }])
    expect(state.active[0]?.error).toEqual(textNotice('chain: launch of ABC-1 failed'))
    expect(state.leftovers).toEqual({ ABC: [{ task: 'ABC-0', at: 't', notice: textNotice('ABC-0: the worktree was kept') }] })
  })

  it('reads a file saved before tasks could be skipped or leave leftovers', () => {
    const file = join(dir(), 'chain.json')
    writeFileSync(file, '{"active": null, "queue": [], "orders": {}}')
    expect(loadChainState(file)).toEqual(emptyChainState())
    expect(loadChainState(file).trimTools).toBe(true)
  })

  it('forgets a session start the service did not live to finish', () => {
    const file = join(dir(), 'chain.json')
    const current = { task: 'ABC-1', sessionId: 's1', since: 't', starting: 't' }
    writeFileSync(file, JSON.stringify({ active: [{ project: 'ABC', current, paused: false, error: null }], queue: [], orders: {} }))
    expect(loadChainState(file).active[0]?.current).toEqual({ task: 'ABC-1', sessionId: 's1', since: 't' })
  })

  it('refuses a damaged file instead of silently forgetting the chain', () => {
    const file = join(dir(), 'chain.json')
    writeFileSync(file, '{"active": 5}')
    expect(() => loadChainState(file)).toThrow(/chain\.json/)
    writeFileSync(file, '{"active": [{"project": "ABC"}, 5], "queue": [], "orders": {}}')
    expect(() => loadChainState(file)).toThrow(/chain\.json/)
  })

  it('appends launches and reads them back in order', () => {
    const file = join(dir(), 'nested', 'launches.jsonl')
    expect(readLaunches(file)).toEqual([])
    const first = { at: '2026-09-26T10:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 's1' }
    const second = { at: '2026-09-26T11:00:00.000Z', project: 'ABC', task: 'ABC-2', sessionId: 's2' }
    appendLaunch(file, first)
    appendLaunch(file, second)
    expect(readLaunches(file)).toEqual([first, second])
  })

  describe('projects by id in the files', () => {
    const ids = { ABC: 'id-abc', XYZ: 'id-xyz' }

    it('saves the chain under the ids and the schema version and reads it back by key', () => {
      const file = join(dir(), 'chain.json')
      const state: ChainState = {
        ...emptyChainState(),
        active: [{ project: 'ABC', current: null, paused: false, error: null }],
        queue: ['XYZ'],
        orders: { ABC: ['ABC-1'], XYZ: [] },
        ci: { XYZ: { green: 'abc123' } },
      }
      saveChainState(file, state, ids)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      expect(saved.version).toBe(2)
      expect(saved.active[0].project).toBe('id-abc')
      expect(saved.queue).toEqual(['id-xyz'])
      expect(Object.keys(saved.orders)).toEqual(['id-abc', 'id-xyz'])
      expect(loadChainState(file, ids)).toEqual(state)
    })

    it('keeps the id of a project the config no longer has', () => {
      const file = join(dir(), 'chain.json')
      writeFileSync(file, JSON.stringify({ version: 2, active: [], queue: [], orders: { 'id-gone': ['OLD-1'] } }))
      expect(loadChainState(file, ids).orders).toEqual({ 'id-gone': ['OLD-1'] })
    })

    it('refuses a chain file of a newer version', () => {
      const file = join(dir(), 'chain.json')
      writeFileSync(file, JSON.stringify({ version: 3, active: [], queue: [], orders: {} }))
      expect(() => loadChainState(file, ids)).toThrow(/newer/)
    })

    it('opens a new launches log with the version line and names projects by id in it', () => {
      const file = join(dir(), 'launches.jsonl')
      const entry = { at: 't', project: 'ABC', task: 'ABC-1', sessionId: 's1' }
      appendLaunch(file, entry, ids)
      appendLaunch(file, entry, ids)
      const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      expect(lines).toEqual([{ version: 2 }, { ...entry, project: 'id-abc' }, { ...entry, project: 'id-abc' }])
      expect(readLaunches(file, ids)).toEqual([entry, entry])
      expect(readLaunches(file)).toEqual([
        { ...entry, project: 'id-abc' },
        { ...entry, project: 'id-abc' },
      ])
    })

    it('saves the questions under the version and reads the bare list of an older file', () => {
      const file = join(dir(), 'questions.json')
      expect(loadQuestions(file)).toEqual([])
      const posted = [{ task: 'ABC-1', sessionId: 's1', ask: 'a', comment: 'c' }]
      saveQuestions(file, posted)
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, questions: posted })
      expect(loadQuestions(file)).toEqual(posted)
      writeFileSync(file, JSON.stringify(posted))
      expect(loadQuestions(file)).toEqual(posted)
    })
  })
})
