import { describe, expect, it } from 'vitest'
import type { BlockLamp } from '../state.js'
import { estimateShare, isRework, railsOf, showsAction, tiersOf } from './look.js'

const item = (id: string, lamp: BlockLamp = 'ahead', current = false, live = false) => ({ id, lamp, current, live })

describe('tiersOf', () => {
  it('makes the current task the lead, the next three near and the rest far', () => {
    const tiers = tiersOf([item('A', 'done'), item('B', 'working', true, true), item('C'), item('D'), item('E'), item('F'), item('G')])
    expect([...tiers.values()]).toEqual(['past', 'lead', 'near', 'near', 'near', 'far', 'far'])
  })

  it('has no lead without a current task', () => {
    const tiers = tiersOf([item('A'), item('B'), item('C'), item('D')])
    expect([...tiers.values()]).toEqual(['near', 'near', 'near', 'far'])
  })

  it('keeps a far task with a live session near, for its meters', () => {
    const tiers = tiersOf([item('A'), item('B'), item('C'), item('D'), item('E', 'working', false, true)])
    expect(tiers.get('E')).toBe('near')
  })
})

describe('showsAction', () => {
  it('shows the lead session while it works or is held by an error or a limit', () => {
    expect(showsAction('lead', 'working')).toBe(true)
    expect(showsAction('lead', 'error')).toBe(true)
    expect(showsAction('lead', 'limit')).toBe(true)
  })

  it('folds the lead to one line once its session waits for a reply or has finished', () => {
    expect(showsAction('lead', 'waiting')).toBe(false)
    expect(showsAction('lead', 'finished')).toBe(false)
    expect(showsAction('lead', null)).toBe(false)
  })

  it('shows any other session only while it works, as after the chain is stopped', () => {
    expect(showsAction('near', 'working')).toBe(true)
    expect(showsAction('far', 'working')).toBe(true)
    expect(showsAction('near', 'waiting')).toBe(false)
    expect(showsAction('past', 'working')).toBe(false)
  })
})

describe('estimateShare', () => {
  it('grows on a log scale from the shortest step to four hours', () => {
    expect(estimateShare(null)).toBeNull()
    expect(estimateShare(0)).toBeNull()
    expect(estimateShare(5 / 60)).toBeCloseTo(0.18, 2)
    expect(estimateShare(40 / 60)).toBeCloseTo(0.56, 2)
    expect(estimateShare(4)).toBe(1)
    expect(estimateShare(10)).toBe(1)
  })
})

describe('railsOf', () => {
  const row = (id: string, parent: string | null = null) => ({ id, parent })

  it('ties siblings with a rail that passes through the tasks between them', () => {
    const rails = railsOf([row('A', 'P'), row('B'), row('C', 'P'), row('D', 'P'), row('E')])
    expect(rails.get('A')).toEqual([{ family: 'P', lane: 0, hue: expect.any(Number), part: 'start' }])
    expect(rails.get('B')![0]!.part).toBe('pass')
    expect(rails.get('C')![0]!.part).toBe('middle')
    expect(rails.get('D')![0]!.part).toBe('end')
    expect(rails.has('E')).toBe(false)
  })

  it('draws no rail for an only child', () => {
    expect(railsOf([row('A', 'P'), row('B', 'Q'), row('C')]).size).toBe(0)
  })

  it('puts overlapping families on separate lanes and reuses a free one', () => {
    const rails = railsOf([row('A', 'P'), row('B', 'Q'), row('C', 'P'), row('D', 'Q'), row('E', 'R'), row('F', 'R')])
    expect(rails.get('B')!.map((rail) => [rail.family, rail.lane])).toEqual([
      ['P', 0],
      ['Q', 1],
    ])
    expect(rails.get('E')!.map((rail) => [rail.family, rail.lane])).toEqual([['R', 0]])
  })

  it('gives a family the same hue wherever it stands', () => {
    const one = railsOf([row('A', 'P'), row('B', 'P')]).get('A')![0]!.hue
    const two = railsOf([row('X'), row('A', 'P'), row('C', 'Q'), row('B', 'P')]).get('A')![0]!.hue
    expect(one).toBe(two)
  })
})

describe('isRework', () => {
  it('knows the rework label in both languages, in any case', () => {
    expect(isRework(['Переделка'])).toBe(true)
    expect(isRework(['rework'])).toBe(true)
    expect(isRework(['Sonnet'])).toBe(false)
  })
})
