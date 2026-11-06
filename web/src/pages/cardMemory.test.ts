import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskCard } from '../../../src/tracker/card.js'
import { CARD_MEMORY_LIMIT, forgetCards, recallCard, rememberCard } from './cardMemory.js'

const card = (title: string) => ({ id: 'ABC-1', title }) as TaskCard

describe('the remembered task card', () => {
  beforeEach(() => forgetCards())

  it('knows nothing before the first read', () => {
    expect(recallCard('p1', 'ABC-1')).toBeUndefined()
  })

  it('gives back the last card read for the task', () => {
    rememberCard('p1', 'ABC-1', card('old'))
    rememberCard('p1', 'ABC-1', card('new'))
    expect(recallCard('p1', 'ABC-1')?.title).toBe('new')
  })

  it('keeps tasks of two projects with the same key apart', () => {
    rememberCard('p1', 'ABC-1', card('first'))
    rememberCard('p2', 'ABC-1', card('second'))
    expect(recallCard('p1', 'ABC-1')?.title).toBe('first')
    expect(recallCard('p2', 'ABC-1')?.title).toBe('second')
  })

  it('forgets a task the tracker no longer has', () => {
    rememberCard('p1', 'ABC-1', card('old'))
    rememberCard('p1', 'ABC-1', null)
    expect(recallCard('p1', 'ABC-1')).toBeUndefined()
  })

  it('drops the least recently used card past the limit', () => {
    for (let n = 0; n < CARD_MEMORY_LIMIT; n++) rememberCard('p1', `ABC-${n}`, card(`${n}`))
    recallCard('p1', 'ABC-0')
    rememberCard('p1', 'ABC-new', card('new'))
    expect(recallCard('p1', 'ABC-0')?.title).toBe('0')
    expect(recallCard('p1', 'ABC-1')).toBeUndefined()
    expect(recallCard('p1', 'ABC-new')?.title).toBe('new')
  })
})
