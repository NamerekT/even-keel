import { describe, expect, it } from 'vitest'
import type { Notice } from '../../../src/notice/notice.js'
import type { TrackerProject } from '../../../src/tracker/source.js'
import { EMPTY_LOOKUP, answered, failed, failureShown, retryDelay } from './projectLookup.js'

const unreachable: Notice = { code: 'profiles.unreachable', params: {} } as unknown as Notice
const btn: TrackerProject = { key: 'BTN', name: 'Even Keel' }

describe('the retry of a failed project list', () => {
  it('waits longer after each failure and gives up after a few', () => {
    const delays = [1, 2, 3, 4, 5, 6].map(retryDelay)
    expect(delays.slice(0, 5).every((delay) => delay !== null)).toBe(true)
    for (let i = 1; i < 5; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!)
    expect(delays[5]).toBeNull()
  })

  it('counts the failures of one text and starts over for another', () => {
    const once = failed(EMPTY_LOOKUP, 'BTN', unreachable)
    const twice = failed(once, 'BTN', unreachable)
    expect(twice.failures).toBe(2)
    expect(failed(twice, 'BT', unreachable).failures).toBe(1)
  })

  it('keeps the list it had when a later ask fails', () => {
    const shown = answered([btn], 'BTN')
    const after = failed(shown, 'BTN', unreachable)
    expect(after.list).toEqual([btn])
    expect(after.failure).toBe(unreachable)
  })

  it('clears the failure and its count once the tracker answers', () => {
    expect(failed(EMPTY_LOOKUP, 'BTN', unreachable).failures).toBe(1)
    expect(answered([btn], 'BTN')).toEqual({ list: [btn], of: 'BTN', failure: null, failures: 0 })
  })
})

describe('how a failed list shows', () => {
  it('is no alarm while the value is confirmed by a list shown before', () => {
    expect(failureShown(unreachable, 'BTN', true)).toBe('quiet')
  })

  it('is quiet while nothing is typed: there is nothing to check', () => {
    expect(failureShown(unreachable, '  ', false)).toBe('quiet')
  })

  it('is an alert only for a typed value the tracker has not confirmed', () => {
    expect(failureShown(unreachable, 'BTN', false)).toBe('alert')
  })

  it('shows nothing without a failure', () => {
    expect(failureShown(null, 'BTN', false)).toBeNull()
  })
})
