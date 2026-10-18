import { describe, expect, it } from 'vitest'
import type { RemoteRef } from '../../../src/state.js'
import { homeBlocks, parseGrouping, zoned } from './homeGroups.js'

const ref = (id: string): RemoteRef => ({ id: `git.example.com/${id}`, path: id })

describe('homeBlocks by remote', () => {
  const remotes = {
    BTN: [ref('john/even-keel')],
    TSK: [ref('john/demo')],
    SOLO: [ref('john/solo')],
    EVK: [ref('john/even-keel'), ref('octo-org/even-keel')],
    DT: [ref('john/demo')],
  }

  it('groups the clones of one repository and titles them by its path', () => {
    expect(homeBlocks('remote', ['BTN', 'TSK', 'SOLO', 'EVK', 'DT'], { remotes, trackers: [] })).toEqual([
      { title: 'john/even-keel', sections: [{ title: null, projects: ['BTN', 'EVK'] }] },
      { title: 'john/demo', sections: [{ title: null, projects: ['TSK', 'DT'] }] },
      { title: null, sections: [{ title: null, projects: ['SOLO'] }] },
    ])
  })

  it('joins projects through a remote they share with a third one', () => {
    const chained = { A: [ref('john/a')], B: [ref('john/a'), ref('john/b')], C: [ref('john/b')] }
    expect(homeBlocks('remote', ['A', 'C', 'B'], { remotes: chained, trackers: [] })).toEqual([
      { title: 'john/a', sections: [{ title: null, projects: ['A', 'C', 'B'] }] },
    ])
  })

  it('titles a group by the remote most of its projects share', () => {
    const three = { A: [ref('john/a')], B: [ref('john/b'), ref('john/a')], C: [ref('john/b')], D: [ref('john/b')] }
    expect(homeBlocks('remote', ['A', 'B', 'C', 'D'], { remotes: three, trackers: [] })[0]!.title).toBe('john/b')
  })

  it('leaves a project without remotes alone', () => {
    expect(homeBlocks('remote', ['A', 'B'], { remotes: { A: [] }, trackers: [] })).toEqual([
      { title: null, sections: [{ title: null, projects: ['A', 'B'] }] },
    ])
  })
})

describe('homeBlocks by tracker', () => {
  const trackers = [
    { name: 'huly', title: 'Huly', projects: ['BTN', 'TSK', 'DT'] },
    { name: 'github', title: 'GitHub', projects: ['EVK'] },
  ]

  it('groups the projects of one tracker connection and puts the lone ones together', () => {
    expect(homeBlocks('tracker', ['BTN', 'EVK', 'TSK', 'DT', 'NONE'], { remotes: {}, trackers })).toEqual([
      { title: 'Huly', sections: [{ title: null, projects: ['BTN', 'TSK', 'DT'] }] },
      { title: null, sections: [{ title: null, projects: ['EVK', 'NONE'] }] },
    ])
  })

  it('splits a remote group by tracker only when it has two of them', () => {
    const remotes = { BTN: [ref('john/even-keel')], EVK: [ref('john/even-keel')], TSK: [ref('john/demo')], DT: [ref('john/demo')] }
    expect(homeBlocks('both', ['BTN', 'TSK', 'EVK', 'DT'], { remotes, trackers })).toEqual([
      {
        title: 'john/even-keel',
        sections: [
          { title: 'Huly', projects: ['BTN'] },
          { title: 'GitHub', projects: ['EVK'] },
        ],
      },
      { title: 'john/demo', sections: [{ title: null, projects: ['TSK', 'DT'] }] },
    ])
  })
})

describe('parseGrouping', () => {
  it('reads a saved choice and falls back to remote', () => {
    expect(parseGrouping('both')).toBe('both')
    expect(parseGrouping(null)).toBe('remote')
    expect(parseGrouping('folder')).toBe('remote')
  })
})

describe('zoned', () => {
  it('puts the working projects first and the quiet ones last, in config order inside each', () => {
    const zones = { A: 'quiet', B: 'working', C: 'cards', D: 'working', E: 'quiet' } as const
    expect(zoned(['A', 'B', 'C', 'D', 'E'], (key) => zones[key as keyof typeof zones])).toEqual({
      working: ['B', 'D'],
      cards: ['C'],
      quiet: ['A', 'E'],
    })
  })
})
