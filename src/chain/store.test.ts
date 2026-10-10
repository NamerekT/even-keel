import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyChainState, type ChainState } from './dispatcher.js'
import { appendLaunch, loadChainState, readLaunches, saveChainState } from './store.js'
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
})
