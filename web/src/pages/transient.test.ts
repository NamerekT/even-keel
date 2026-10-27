import { expect, it } from 'vitest'
import { waitingSessions } from '../state.js'
import { session } from '../live/fakeSessions.js'
import { fakeTask } from '../../../src/tracker/fixture.js'

it('does not count an overloaded session as a question waiting for a person', () => {
  const view = { ...session('ABC-5', 0, 'waiting'), apiErrorKind: 'transient' as const, asking: false, ask: null }
  expect(waitingSessions([view], [fakeTask('ABC-5')])).toEqual([])
})
