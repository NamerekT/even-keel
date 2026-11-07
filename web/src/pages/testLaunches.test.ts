import { expect, it } from 'vitest'
import { testLaunches } from './testLaunches.js'

it('hides test GUIDs from counts and legend without changing stored launches', () => {
  const days = [{ day: '2026-11-07', counts: { ordinary: 3, sandbox: 7, removed: 2 } }]
  const slots = { ordinary: 1, sandbox: 2 }
  expect(testLaunches(days, slots, ['sandbox'])).toEqual({ days: [{ day: '2026-11-07', counts: { ordinary: 3, removed: 2 } }], slots: { ordinary: 1 } })
  expect(days[0]!.counts.sandbox).toBe(7)
  expect(testLaunches(days, slots, []).days).toEqual(days)
})
