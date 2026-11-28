import { describe, expect, it } from 'vitest'
import { chainHoldOf, holdPlace } from '../ciHold.js'
import { fakeCi, fakeMainCi } from './fakeCi.js'

describe('fakeCi', () => {
  it('ci=redpush: a red last run of main, a push no run has taken yet and the next task waiting on it (BTN-1816)', () => {
    const views = fakeCi('redpush').ABC!
    const { mainCi, ciWait } = fakeMainCi('redpush')
    expect(views[0]!.current!.runs.map((each) => each.run.status)).toEqual(['failure'])
    expect(views[0]!.pushed?.commit).toBe(ciWait?.commit)
    expect(holdPlace(chainHoldOf(ciWait, mainCi.ABC)!, views)).toEqual({ index: 0, at: 'pushed' })
  })
})
