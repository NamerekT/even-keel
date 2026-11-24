import { describe, expect, it } from 'vitest'
import type { ActiveChain, ChainMachines, ChainState } from '../chain/model.js'
import { pinnable, pinWaits } from './pins.js'

const P = 'proj-1'

function machines(over: Partial<ChainMachines> & { online?: string[]; holders?: Record<string, string> } = {}): ChainMachines {
  const online = over.online ?? ['own', 'pc', 'srv']
  return {
    own: () => 'own',
    list: () => online.map((id) => ({ id, capacity: 1 })),
    serves: (_project, machine) => ['own', 'pc', 'srv'].includes(machine),
    width: () => 2,
    holder: (_project, task) => over.holders?.[task],
    runs: () => true,
    gone: (machine) => machine === 'old',
    bind: () => {},
    ...over,
  }
}

const lane = (task: string, machine: string, project = P): ActiveChain => ({ project, machine, current: { task } }) as unknown as ActiveChain
const state = (...active: ActiveChain[]): ChainState => ({ active }) as unknown as ChainState

describe('pinnable', () => {
  it('is the pool turned on and not revoked, the own machine of a project with none', () => {
    expect(pinnable(['pc', 'old', 'srv'], ['own', 'pc', 'srv'], 'own')).toEqual(['pc', 'srv'])
    expect(pinnable([], ['own', 'pc'], 'own')).toEqual(['own'])
    expect(pinnable(['old'], ['own'], 'own')).toEqual(['own'])
  })
})

describe('pinWaits (BTN-1623)', () => {
  it('a pinned task whose machine is online and free waits for nothing', () => {
    expect(pinWaits(P, { 'A-1': ['pc'] }, state(), machines())).toEqual({})
  })

  it('waits "busy" while each online machine of its list runs a task of the project', () => {
    expect(pinWaits(P, { 'A-1': ['pc'] }, state(lane('A-2', 'pc')), machines())).toEqual({ 'A-1': 'busy' })
    // A machine full of another project's lanes is busy as well.
    expect(pinWaits(P, { 'A-1': ['pc'] }, state(lane('B-1', 'pc', 'other')), machines())).toEqual({ 'A-1': 'busy' })
    expect(pinWaits(P, { 'A-1': ['pc', 'srv'] }, state(lane('A-2', 'pc')), machines())).toEqual({})
  })

  it('waits "offline" while no machine of its list is on the link', () => {
    expect(pinWaits(P, { 'A-1': ['pc'] }, state(), machines({ online: ['own', 'srv'] }))).toEqual({ 'A-1': 'offline' })
  })

  it('is "gone" when every machine of its list is revoked or out of the pool', () => {
    expect(pinWaits(P, { 'A-1': ['old'] }, state(), machines())).toEqual({ 'A-1': 'gone' })
    expect(pinWaits(P, { 'A-1': ['far'] }, state(), machines())).toEqual({ 'A-1': 'gone' })
  })

  it('is "elsewhere" when a machine off its list holds it, in a lane or not', () => {
    expect(pinWaits(P, { 'A-1': ['pc'] }, state(lane('A-1', 'srv')), machines({ holders: { 'A-1': 'srv' } }))).toEqual({ 'A-1': 'elsewhere' })
    expect(pinWaits(P, { 'A-1': ['pc'] }, state(), machines({ holders: { 'A-1': 'srv' } }))).toEqual({ 'A-1': 'elsewhere' })
  })

  it('a task running in a lane of its own machine, or with no pin, waits for nothing', () => {
    expect(pinWaits(P, { 'A-1': ['pc'] }, state(lane('A-1', 'pc')), machines({ online: ['own'], holders: { 'A-1': 'pc' } }))).toEqual({})
    expect(pinWaits(P, { 'A-1': [] }, state(), machines({ online: ['own'] }))).toEqual({})
  })

  it('a task its own pinned machine holds waits for that one, not for another of the list', () => {
    expect(pinWaits(P, { 'A-1': ['pc', 'srv'] }, state(), machines({ online: ['own', 'srv'], holders: { 'A-1': 'pc' } }))).toEqual({ 'A-1': 'offline' })
  })
})
