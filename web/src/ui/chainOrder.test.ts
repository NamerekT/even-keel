import { describe, expect, it } from 'vitest'
import type { ChainBlock } from '../state.js'
import { pinnedHead, withOrder } from './chainOrder.js'
import { reorderable } from '../pages/useChainDrag.js'
import { moveItem } from './drag.js'
import { clampDrop, dropBounds } from './reorder.js'

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

  it('pins every running lane as one group (BTN-1611)', () => {
    expect(pinnedHead([block('A-2', { current: true }), block('A-3', { current: true }), block('A-4')])).toBe(2)
    expect(pinnedHead([block('A-2', { current: true }), block('A-3', { current: true }), block('A-4', { current: true }), block('A-5')])).toBe(3)
  })

  it('counts a lane whose task a fix interrupted among the running ones', () => {
    expect(pinnedHead([block('A-2', { current: true }), block('A-3', { interrupted: true }), block('A-4')])).toBe(2)
  })
})

describe('a drop above the running lanes (BTN-1611)', () => {
  it('lands right after the last running task', () => {
    const chain = [block('A-1', { open: false }), block('A-2', { current: true }), block('A-3', { current: true }), block('A-4'), block('A-5')]
    const open = chain.filter((each) => each.open)
    const order = ids(open)
    const from = order.indexOf('A-5')
    const bounds = dropBounds(order, new Map(open.map((each) => [each.id, each.after])), from, pinnedHead(open))
    expect(bounds.min).toBe(2)
    const to = clampDrop(bounds, 1, from)
    expect(ids(withOrder(chain, moveItem(order, from, to)))).toEqual(['A-1', 'A-2', 'A-3', 'A-5', 'A-4'])
  })
})

describe('reorderable', () => {
  it('holds the task a fix interrupted in place', () => {
    expect(reorderable(block('A-2', { interrupted: true }))).toBe(false)
    expect(reorderable(block('A-3'))).toBe(true)
  })
})
