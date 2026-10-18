import { describe, expect, it } from 'vitest'
import { removalBlock, type RemovalFacts } from './removal.js'

const free: RemovalFacts = { project: 'ABC', chain: false, sessions: [], held: [], leftovers: [] }

describe('removalBlock', () => {
  it('lets a project with nothing running and no place taken go', () => {
    expect(removalBlock(free)).toBeNull()
  })

  it('names everything that keeps the project', () => {
    expect(removalBlock({ ...free, chain: true, sessions: ['ABC-3 (s-1)'], held: ['ABC-3', 'ABC-2'], leftovers: ['ABC-1'] })).toEqual({
      code: 'project.removeBlocked',
      params: { project: 'ABC' },
      items: [
        { code: 'project.removeChain', params: {} },
        { code: 'project.removeSessions', params: { sessions: ['ABC-3 (s-1)'] } },
        { code: 'project.removePlaces', params: { tasks: ['ABC-3', 'ABC-2'] } },
        { code: 'project.removeLeftovers', params: { tasks: ['ABC-1'] } },
      ],
    })
  })

  it('names only what there is', () => {
    expect(removalBlock({ ...free, leftovers: ['ABC-1'] })?.items).toEqual([{ code: 'project.removeLeftovers', params: { tasks: ['ABC-1'] } }])
  })
})
