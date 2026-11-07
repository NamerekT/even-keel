import { describe, expect, it } from 'vitest'
import type { ChainBlock } from '../state.js'
import { pinnedHead, withOrder } from './chainOrder.js'
import { reorderable } from '../pages/useChainDrag.js'

const block = (id: string, extra: Partial<ChainBlock> = {}): ChainBlock =>
  ({ id, open: true, locked: false, blockedBy: [], after: [], current: false, ...extra }) as ChainBlock

const ids = (blocks: ChainBlock[]) => blocks.map((each) => each.id)

describe('withOrder', () => {
  it('keeps the closed rows on top and lays the open ones out in the order', () => {
    const chain = [block('A-1', { open: false }), block('A-2', { current: true }), block('A-3'), block('A-4')]
    expect(ids(withOrder(chain, ['A-2', 'A-4', 'A-3']))).toEqual(['A-1', 'A-2', 'A-4', 'A-3'])
  })

  it('keeps an asked carry right after the current task', () => {
    const chain = [block('A-1', { open: false }), block('A-2', { current: true }), block('EKR-CARRY.12'), block('A-3'), block('A-4')]
    expect(ids(withOrder(chain, ['A-2', 'A-4', 'A-3']))).toEqual(['A-1', 'A-2', 'EKR-CARRY.12', 'A-4', 'A-3'])
  })

  it('keeps an asked carry right after the task a fix interrupted, and the fix right above that task', () => {
    const chain = [block('A-FIX.3', { current: true }), block('A-2', { interrupted: true }), block('EKR-CARRY.12'), block('A-3'), block('A-4')]
    expect(ids(withOrder(chain, ['A-2', 'A-4', 'A-3']))).toEqual(['A-FIX.3', 'A-2', 'EKR-CARRY.12', 'A-4', 'A-3'])
  })

  it('keeps an asked carry right after a fix that interrupted nothing', () => {
    const chain = [block('A-FIX.3', { current: true }), block('EKR-CARRY.12'), block('A-2'), block('A-3')]
    expect(ids(withOrder(chain, ['A-3', 'A-2']))).toEqual(['A-FIX.3', 'EKR-CARRY.12', 'A-3', 'A-2'])
  })

  it('leaves a running carry on top', () => {
    const chain = [block('EKR-CARRY.12', { current: true }), block('A-2'), block('A-3')]
    expect(ids(withOrder(chain, ['A-3', 'A-2']))).toEqual(['EKR-CARRY.12', 'A-3', 'A-2'])
  })

  it('puts an asked carry on top when the chain runs nothing', () => {
    const chain = [block('EKR-CARRY.12'), block('A-2'), block('A-3')]
    expect(ids(withOrder(chain, ['A-3', 'A-2']))).toEqual(['EKR-CARRY.12', 'A-3', 'A-2'])
  })
})

describe('pinnedHead', () => {
  it('pins the current task', () => {
    expect(pinnedHead([block('A-2', { current: true }), block('A-3')])).toBe(1)
  })

  it('pins the task a running fix interrupted', () => {
    expect(pinnedHead([block('A-2', { interrupted: true }), block('A-3')])).toBe(1)
  })

  it('pins nothing when the first task is neither', () => {
    expect(pinnedHead([block('A-2'), block('A-3')])).toBe(0)
  })
})

describe('reorderable', () => {
  it('holds the task a fix interrupted in place', () => {
    expect(reorderable(block('A-2', { interrupted: true }))).toBe(false)
    expect(reorderable(block('A-3'))).toBe(true)
  })
})
