import { describe, expect, it } from 'vitest'
import type { TrackerView } from '../../../src/tracker/health.js'
import { offProfile, readingTasks, type ProfileOffState } from './profileOff.js'

const view = (over: Partial<TrackerView>): TrackerView => ({
  name: 'p-1',
  kind: 'gitlab',
  title: 'GitLab · example',
  projects: ['abc'],
  ready: false,
  health: { state: 'live', lastOkAt: null, error: null },
  readAt: { abc: '2026-11-08T10:00:00.000Z' },
  ...over,
})

const state = (trackers: TrackerView[], feeds: { id: string }[] = []): ProfileOffState => ({
  trackers,
  config: { feeds: { abc: feeds } } as unknown as ProfileOffState['config'],
  profiles: { profiles: [{ id: 'p-1', name: 'GitLab · example' }, { id: 'p-2', name: 'Linear · example' }] } as unknown as ProfileOffState['profiles'],
})

describe('a project on a turned-off profile (BTN-830)', () => {
  it('names the turned-off profile of its own tracker', () => {
    expect(offProfile(state([view({ disabled: true, health: { state: 'off', lastOkAt: null, error: null } })]), 'abc')).toEqual({ id: 'p-1', name: 'GitLab · example' })
  })

  it('names that of a feed too', () => {
    const feed = view({ name: 'p-2', projects: ['feed-1'], disabled: true, health: { state: 'off', lastOkAt: null, error: null } })
    expect(offProfile(state([view({}), feed], [{ id: 'feed-1' }]), 'abc')).toEqual({ id: 'p-2', name: 'Linear · example' })
  })

  it('names none while every profile is on', () => {
    expect(offProfile(state([view({})]), 'abc')).toBeNull()
  })
})

describe('Start waits for a fresh read (BTN-830)', () => {
  it('waits while the last read is older than the link turning live', () => {
    expect(readingTasks(state([view({ liveSince: '2026-11-08T10:05:00.000Z' })]), 'abc')).toBe(true)
  })

  it('waits while a live tracker has not read the project yet', () => {
    expect(readingTasks(state([view({ readAt: {} })]), 'abc')).toBe(true)
  })

  it('does not wait after a read since then', () => {
    expect(readingTasks(state([view({ liveSince: '2026-11-08T09:00:00.000Z' })]), 'abc')).toBe(false)
  })

  it('does not wait on a tracker that is off: there is nothing to read', () => {
    expect(readingTasks(state([view({ readAt: {}, health: { state: 'off', lastOkAt: null, error: null } })]), 'abc')).toBe(false)
  })

  it('waits on a feed read before its tracker went down', () => {
    const feed = view({ name: 'p-2', projects: ['feed-1'], readAt: { 'feed-1': '2026-11-08T08:00:00.000Z' }, liveSince: '2026-11-08T09:00:00.000Z' })
    expect(readingTasks(state([view({}), feed], [{ id: 'feed-1' }]), 'abc')).toBe(true)
  })
})
