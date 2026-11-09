import { describe, expect, it } from 'vitest'
import type { ActiveChain, CurrentTask } from '../chain/model.js'
import { busyChains } from './settle.js'

const task = (extra: Partial<CurrentTask> = {}) => ({ task: 'ABC-1', sessionId: 'session-1', ...extra }) as CurrentTask
const chain = (project: string, extra: Partial<ActiveChain> = {}): ActiveChain => ({ project, current: task(), paused: false, error: null, ...extra })
const now = new Date('2026-11-09T10:00:00Z')

describe('busyChains', () => {
  it('lets a chain whose session works, or a paused one, go', () => {
    expect(busyChains([chain('ABC'), chain('DEF', { current: null, paused: true })], now)).toEqual([])
  })

  it('waits for a launch, a handover and a closing', () => {
    const chains = [
      chain('LAU', { current: task({ starting: '2026-10-22T10:00:00Z' }) }),
      chain('HAN', { current: task({ sessionId: null }) }),
      chain('CLO', { closing: 'CLO-3' }),
      chain('NXT', { current: null }),
    ]
    expect(busyChains(chains, now)).toEqual(['LAU', 'HAN', 'CLO', 'NXT'])
  })

  it('does not wait for the CI of main, but does for the project’s own check of it', () => {
    const ci = { commit: 'a1b2c3d', since: '2026-10-22T10:00:00Z' }
    expect(busyChains([chain('CI', { current: null, ciWait: ci })], now)).toEqual([])
    expect(busyChains([chain('LOC', { current: null, ciWait: { ...ci, local: true } })], now)).toEqual(['LOC'])
  })

  it.each([
    ['2026-11-09T10:10:00Z', false],
    ['2026-11-09T10:01:00.001Z', false],
    ['2026-11-09T10:01:00Z', true],
    ['2026-11-09T10:00:30Z', true],
    ['2026-11-09T09:59:59Z', true],
    ['invalid', true],
  ])('checks both kinds of limit hold at %s against the supplied time', (until, busy) => {
    const chains = [chain('LIM', { current: null, limitUntil: until }), chain('MOD', { current: null, modelWeek: { model: 'Fable', until } })]
    expect(busyChains(chains, now)).toEqual(busy ? ['LIM', 'MOD'] : [])
  })

  it('does not wait for a model week whose reset is unknown', () => {
    expect(busyChains([chain('MOD', { current: null, modelWeek: { model: 'Fable', until: null } })], now)).toEqual([])
  })

  it('waits again when a repeated check reaches the last minute of a hold', () => {
    const chains = [chain('LIM', { current: null, limitUntil: '2026-11-09T10:10:00Z' })]
    expect(busyChains(chains, now)).toEqual([])
    expect(busyChains(chains, new Date('2026-11-09T10:09:00Z'))).toEqual(['LIM'])
  })

  it('keeps the old rule for current tasks and closings despite a limit hold', () => {
    const holds: Partial<ActiveChain>[] = [{ limitUntil: '2026-11-09T10:10:00Z' }, { modelWeek: { model: 'Fable', until: null } }]
    for (const hold of holds) {
      expect(busyChains([
        chain('RUN', hold),
        chain('LAU', { ...hold, current: task({ starting: now.toISOString() }) }),
        chain('HAN', { ...hold, current: task({ sessionId: null }) }),
        chain('CLO', { ...hold, current: null, closing: 'CLO-1' }),
        chain('PAU', { ...hold, current: null, closing: 'PAU-1', paused: true }),
      ], now)).toEqual(['LAU', 'HAN', 'CLO'])
    }
  })

  it('still waits for the first limits poll, a slot or an empty queue without a limit hold', () => {
    expect(busyChains([
      chain('POL', { current: null, limitsWait: { account: 'test', next: null } }),
      chain('SLO', { current: null, slotWait: { at: now.toISOString(), notice: { code: 'slot.waiting', params: { task: 'SLO-1' } } } }),
      chain('NXT', { current: null }),
    ], now)).toEqual(['POL', 'SLO', 'NXT'])
  })
})
