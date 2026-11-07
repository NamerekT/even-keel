import type { TrackerLinkState, TrackerView } from '../../../src/tracker/health.js'
import { FAKE_HULY_PROFILE, GITHUB_PROFILE, LINEAR_PROFILE } from './fakeProfiles.js'
import { ago } from './fakeSessions.js'

export function fakeHuly(state: TrackerLinkState): TrackerView {
  const projects = ['ABC', 'DEMO', 'XYZ', 'OPS']
  const view = { name: FAKE_HULY_PROFILE, kind: 'huly', title: 'Huly · example', projects, ready: true, unready: true, relabel: true }
  const readAt = (minutes: number) => Object.fromEntries(projects.map((project) => [project, ago(minutes)]))
  if (state === 'off' || state === 'connecting') return { ...view, health: { state, lastOkAt: null, error: null }, readAt: {} }
  if (state === 'down') return { ...view, health: { state, lastOkAt: ago(4), error: 'huly: call timed out after 15000 ms' }, readAt: readAt(4) }
  return { ...view, health: { state, lastOkAt: ago(0), error: null }, readAt: readAt(0) }
}

/** The trackers of ABC's task feeds: GitHub has read its feed, Linear not yet. */
export function fakeFeedTrackers(): TrackerView[] {
  const view = { ready: true, relabel: true, health: { state: 'live' as const, lastOkAt: ago(0), error: null } }
  return [
    { ...view, name: GITHUB_PROFILE, kind: 'github', title: 'GitHub · johndoe', projects: ['feed-abc-gh'], readAt: { 'feed-abc-gh': ago(1) } },
    { ...view, name: LINEAR_PROFILE, kind: 'linear', title: 'Linear · work', projects: ['feed-abc-lin'], readAt: {} },
  ]
}

/**
 * `?trackers=problems` for `/status`: Huly has not read OPS for 12 minutes, Linear's key was refused 12 minutes ago,
 * and a spare GitHub profile serves no project.
 */
export function fakeTrackerProblems(trackers: TrackerView[]): TrackerView[] {
  const changed = trackers.map((tracker): TrackerView => {
    if (tracker.name === FAKE_HULY_PROFILE) return { ...tracker, readAt: { ...tracker.readAt, OPS: ago(12) } }
    if (tracker.name !== LINEAR_PROFILE) return tracker
    return { ...tracker, health: { state: 'down', lastOkAt: ago(12), error: 'linear: 401 Unauthorized' }, readAt: { 'feed-abc-lin': ago(12) } }
  })
  const spare: TrackerView = { name: 'github-spare', kind: 'github', title: 'GitHub · spare', projects: [], ready: false, health: { state: 'off', lastOkAt: null, error: null }, readAt: {} }
  return [...changed, spare]
}
