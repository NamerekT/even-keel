import { describe, expect, it } from 'vitest'
import type { ActiveChain, CurrentTask } from '../chain/model.js'
import { busyChains } from './settle.js'

const task = (extra: Partial<CurrentTask> = {}) => ({ task: 'ABC-1', sessionId: 'session-1', ...extra }) as CurrentTask
const chain = (project: string, extra: Partial<ActiveChain> = {}): ActiveChain => ({ project, current: task(), paused: false, error: null, ...extra })

describe('busyChains', () => {
  it('lets a chain whose session works, or a paused one, go', () => {
    expect(busyChains([chain('ABC'), chain('DEF', { current: null, paused: true })])).toEqual([])
  })

  it('waits for a launch, a handover and a closing', () => {
    const chains = [
      chain('LAU', { current: task({ starting: '2026-10-22T10:00:00Z' }) }),
      chain('HAN', { current: task({ sessionId: null }) }),
      chain('CLO', { closing: 'CLO-3' }),
      chain('NXT', { current: null }),
    ]
    expect(busyChains(chains)).toEqual(['LAU', 'HAN', 'CLO', 'NXT'])
  })

  it('does not wait for the CI of main, but does for the project’s own check of it', () => {
    const ci = { commit: 'a1b2c3d', since: '2026-10-22T10:00:00Z' }
    expect(busyChains([chain('CI', { current: null, ciWait: ci })])).toEqual([])
    expect(busyChains([chain('LOC', { current: null, ciWait: { ...ci, local: true } })])).toEqual(['LOC'])
  })
})
