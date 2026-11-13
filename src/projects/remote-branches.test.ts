import { describe, expect, it } from 'vitest'
import { REMOTE_OFFERED, remoteOffer } from './remote-branches.js'

describe('remoteOffer', () => {
  it('offers every branch of a small remote, the default first, task branches left out', () => {
    const offer = remoteOffer({ head: 'main', branches: ['abc-7/task', 'develop', 'main', 'release/v1'] }, 'dev')
    expect(offer).toEqual({ head: 'main', branches: ['main', 'develop', 'release/v1'], total: 3, typed: 'dev', has: false })
  })

  it('says whether the typed branch is on the remote, a task branch too', () => {
    expect(remoteOffer({ head: 'main', branches: ['main', 'develop'] }, ' develop ').has).toBe(true)
    expect(remoteOffer({ head: 'main', branches: ['main', 'abc-7/task'] }, 'abc-7/task').has).toBe(true)
    expect(remoteOffer({ head: 'main', branches: ['main'] }, '').has).toBe(false)
  })

  it('narrows a big remote to the branches that hold every typed word, the default and the exact one first', () => {
    const many = Array.from({ length: 3000 }, (_, index) => `feature/item-${index}`)
    const offer = remoteOffer({ head: 'main', branches: [...many, 'main', 'fix/item-12'] }, 'item-12')
    expect(offer.total).toBe(3002)
    expect(offer.has).toBe(false)
    expect(offer.branches[0]).toBe('main')
    expect(offer.branches).toContain('fix/item-12')
    expect(offer.branches.every((name) => name === 'main' || name.includes('item-12'))).toBe(true)

    const exact = remoteOffer({ head: 'main', branches: [...many, 'main'] }, 'feature/item-2999')
    expect(exact.branches.slice(0, 2)).toEqual(['main', 'feature/item-2999'])
    expect(exact.has).toBe(true)
  })

  it('keeps a narrowed list to its cap and lists the first ones of a big remote while nothing is typed', () => {
    const many = Array.from({ length: 3000 }, (_, index) => `b${index}`)
    const blank = remoteOffer({ head: 'b2999', branches: many }, '')
    expect(blank.branches).toHaveLength(REMOTE_OFFERED)
    expect(blank.branches[0]).toBe('b2999')
    expect(remoteOffer({ head: null, branches: many }, 'B1').branches).toHaveLength(REMOTE_OFFERED)
  })
})
