import { englishOf, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
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

export const FAKE_OFF_PROFILE = '3f0c2b9e-0000-4000-8000-000000000008'

/**
 * `?trackers=off` (BTN-830): XYZ reads on a GitLab profile that is turned off, so it has no tasks; Huly answered again a
 * minute ago and has not read DEMO since, so DEMO's Start waits for the read.
 */
export function withProfileOff(state: EvenKeelState): EvenKeelState {
  const gitlab: TrackerView = {
    name: FAKE_OFF_PROFILE,
    kind: 'gitlab',
    title: 'GitLab · bench',
    projects: ['XYZ'],
    ready: false,
    health: { state: 'off', lastOkAt: null, error: null },
    readAt: {},
    disabled: true,
  }
  const trackers = state.trackers.map((tracker) =>
    tracker.name === FAKE_HULY_PROFILE
      ? { ...tracker, projects: tracker.projects.filter((project) => project !== 'XYZ'), liveSince: ago(1), readAt: { ...tracker.readAt, DEMO: ago(3) } }
      : tracker,
  )
  const { XYZ: _, ...projects } = state.chain.projects
  const huly = state.profiles.profiles.find((each) => each.id === FAKE_HULY_PROFILE)
  const profile = huly === undefined ? [] : [{ ...huly, id: FAKE_OFF_PROFILE, kind: 'gitlab', name: 'GitLab · bench', isDefault: true, disabled: true, projects: ['XYZ'], projectIds: ['XYZ'], rules: {}, moves: {} }]
  return {
    ...state,
    trackers: [...trackers, gitlab],
    tasks: state.tasks.filter((task) => task.project !== 'XYZ'),
    chain: { ...state.chain, projects },
    profiles: { ...state.profiles, profiles: [...state.profiles.profiles.map((each) => (each.id === FAKE_HULY_PROFILE ? { ...each, projects: each.projects.filter((key) => key !== 'XYZ'), projectIds: each.projectIds.filter((id) => id !== 'XYZ') } : each)), ...profile] },
  }
}

/**
 * `?trackers=down` (BTN-947): XYZ reads on a GitLab profile whose host does not answer and was never read, so it has no
 * tasks; its archive still holds a fix of the main branch, so its chain is not empty.
 */
export function withTrackerDown(state: EvenKeelState): EvenKeelState {
  const gitlab: TrackerView = {
    name: FAKE_OFF_PROFILE,
    kind: 'gitlab',
    title: 'GitLab · bench',
    projects: ['XYZ'],
    ready: false,
    health: { state: 'down', lastOkAt: null, error: 'call timed out after 15000 ms' },
    readAt: {},
  }
  const trackers = state.trackers.map((tracker) => (tracker.name === FAKE_HULY_PROFILE ? { ...tracker, projects: tracker.projects.filter((project) => project !== 'XYZ') } : tracker))
  const { XYZ: _, ...projects } = state.chain.projects
  const fix = { id: 'XYZ-FIX.1', red: '5c95521730bbc58ab20052f7ff807c29a8fbeb65', at: ago(1_400), end: { at: ago(1_390), how: 'landed' as const, commit: '9f77142a5c0e3d1b7e6f4a2c8d9b0e1f2a3b4c5d' } }
  return {
    ...state,
    trackers: [...trackers, gitlab],
    tasks: state.tasks.filter((task) => task.project !== 'XYZ'),
    chain: { ...state.chain, projects },
    fixes: { ...state.fixes, XYZ: [fix] },
  }
}

/**
 * `?trackers=scope` (BTN-788): XYZ reads on a Forgejo profile whose token was made for the CI, without the issue scope;
 * Forgejo refused its first read, so XYZ has no tasks yet.
 */
export function withScopeRefusal(state: EvenKeelState): EvenKeelState {
  const scope = notice('forgejo.scope', { scope: 'read:issue' })
  const forgejo: TrackerView = {
    name: 'forgejo-ci',
    kind: 'forgejo',
    title: 'Forgejo · ci',
    projects: ['XYZ'],
    ready: true,
    health: { state: 'down', lastOkAt: null, error: englishOf(scope), notice: scope },
    readAt: {},
  }
  const trackers = state.trackers.map((tracker) => (tracker.name === FAKE_HULY_PROFILE ? { ...tracker, projects: tracker.projects.filter((project) => project !== 'XYZ') } : tracker))
  const { XYZ: _, ...projects } = state.chain.projects
  return { ...state, trackers: [...trackers, forgejo], tasks: state.tasks.filter((task) => task.project !== 'XYZ'), chain: { ...state.chain, projects } }
}
