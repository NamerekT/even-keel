import { describe, expect, it } from 'vitest'
import { createFakeSource } from './live/fake.js'
import { isOpenToAll, openToAllSources } from './openToAll.js'

const fresh = () => createFakeSource('').snapshot().state!

describe('sources open to anyone (BTN-1134)', () => {
  it('names the feeds and the project the last read found open, by their place', () => {
    const state = fresh()
    const huly = state.trackers.find((tracker) => tracker.projects.includes('ABC'))!
    huly.openToAll = { ABC: true, DEMO: true }
    const github = state.trackers.find((tracker) => tracker.projects.includes('feed-abc-gh'))!
    github.openToAll = { 'feed-abc-gh': true }
    expect(openToAllSources(state, 'ABC')).toEqual([
      { reader: 'ABC', place: state.config.projects.ABC!.trackerProject ?? state.projectKeys.ABC, feed: false },
      { reader: 'feed-abc-gh', place: 'octo-org/storefront-ideas', feed: true },
    ])
    expect(isOpenToAll(state, 'feed-abc-lin')).toBe(false)
  })

  it('says nothing of a source the read found closed, or of a tracker that no longer reads it', () => {
    const state = fresh()
    const github = state.trackers.find((tracker) => tracker.projects.includes('feed-abc-gh'))!
    github.openToAll = { 'feed-abc-gh': false, XYZ: true }
    expect(openToAllSources(state, 'ABC')).toEqual([])
    expect(openToAllSources(state, 'XYZ')).toEqual([])
  })
})
