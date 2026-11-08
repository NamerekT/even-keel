import { describe, expect, it } from 'vitest'
import type { CiView } from '../../src/ci/model.js'
import { chainHoldOf, holdPlace } from './ciHold.js'

const SINCE = '2026-10-12T11:58:00Z'

function view(over: Partial<CiView> = {}): CiView {
  return {
    kind: 'forgejo',
    remote: 'origin',
    repository: 'john/abc',
    counted: true,
    url: 'https://forgejo.example.com/john/abc/actions',
    health: 'ok',
    error: null,
    checkedAt: SINCE,
    current: { commit: 'aaaa', title: 'Merge', manual: false, tasks: [], runs: [] },
    history: [],
    medians: {},
    pushed: null,
    ...over,
  }
}

describe('chainHoldOf (BTN-829)', () => {
  it('names what the chain waits for on main: a verdict, the commands after green, its own check', () => {
    expect(chainHoldOf({ commit: 'aaaa', since: SINCE }, undefined)).toEqual({ kind: 'verdict', commit: 'aaaa', since: SINCE })
    expect(chainHoldOf({ commit: 'aaaa', since: SINCE, after: true }, undefined)).toEqual({ kind: 'after', commit: 'aaaa', since: SINCE })
    expect(chainHoldOf({ commit: 'aaaa', since: SINCE, local: true }, undefined)).toEqual({ kind: 'local', commit: 'aaaa', since: SINCE })
  })

  it('shows the late watch when nothing holds the chain', () => {
    const main = { late: { commit: 'aaaa', until: SINCE }, pushes: {} }
    expect(chainHoldOf(undefined, main)).toEqual({ kind: 'late', commit: 'aaaa', until: SINCE })
    expect(chainHoldOf({ commit: 'bbbb', since: SINCE }, main)?.kind).toBe('verdict')
  })

  it('leaves the fix of another project to the chain’s own line', () => {
    expect(chainHoldOf({ commit: 'aaaa', since: SINCE, by: 'DEMO' }, undefined)).toBeNull()
    expect(chainHoldOf(undefined, { pushes: {} })).toBeNull()
  })
})

describe('holdPlace (BTN-829)', () => {
  const hold = { kind: 'verdict', commit: 'aaaa', since: SINCE } as const

  it('puts the line on the push of the first counted CI at its commit', () => {
    const uncounted = view({ counted: false })
    expect(holdPlace(hold, [view({ current: null }), uncounted, view()])).toEqual({ index: 2, at: 'push' })
  })

  it('puts it by a push no run has taken yet', () => {
    expect(holdPlace(hold, [view({ current: null, pushed: { commit: 'aaaa', at: SINCE } })])).toEqual({ index: 0, at: 'pushed' })
  })

  it('puts it apart in the first card when no CI shows the commit', () => {
    expect(holdPlace({ ...hold, commit: 'cccc' }, [view(), view({ kind: 'github' })])).toEqual({ index: 0, at: 'apart' })
    expect(holdPlace(hold, [])).toBeNull()
  })
})
