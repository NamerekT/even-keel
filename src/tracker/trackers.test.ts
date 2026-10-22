import { describe, expect, it, vi } from 'vitest'
import type { ProfileSet, TrackerProfile } from '../profiles/model.js'
import type { TrackerView } from './health.js'
import type { TrackerAdapter, TrackerSetup } from './source.js'
import type { TrackerHandle } from './start.js'
import { trackerPlans, Trackers, type TrackerConfig } from './trackers.js'

const setupOf = (token: string): TrackerSetup => ({ connect: async () => Promise.reject(new Error(token)), issueUrl: () => `https://${token}/{id}` })

const unchecked = {
  hostVariables: [],
  help: 'https://example.com/help',
  profileName: () => 'profile',
  account: () => Promise.reject(new Error('not here')),
  projects: async () => [],
}

const huly: TrackerAdapter = {
  ...unchecked,
  title: 'Huly',
  variables: ['HULY_TOKEN', 'HULY_URL'],
  setup: (env) => {
    if (env.HULY_TOKEN === undefined && env.HULY_URL === undefined) return undefined
    if (env.HULY_TOKEN === undefined || env.HULY_URL === undefined) throw new Error('HULY_TOKEN and HULY_URL go together')
    return setupOf(env.HULY_TOKEN)
  },
}
const github: TrackerAdapter = {
  ...unchecked,
  title: 'GitHub',
  variables: ['GITHUB_TOKEN'],
  setup: (env, projects) =>
    env.GITHUB_TOKEN === undefined ? undefined : { ...setupOf(env.GITHUB_TOKEN), issueUrl: (project) => (project === null ? `https://${env.GITHUB_TOKEN}` : (projects[project] ?? null)) },
}

/** Each project's id is its key here, except where a case is about the two. */
const config = (more: Partial<TrackerConfig> = {}): TrackerConfig => ({
  projects: { ABC: 'D:/abc', XYZ: 'D:/xyz' },
  keys: { ABC: 'ABC', XYZ: 'XYZ' },
  tracker: 'huly',
  trackers: { ABC: 'huly', XYZ: 'huly' },
  trackerProjects: {},
  ...more,
})

const profile = (id: string, kind: string, values: Record<string, string>, isDefault = true): TrackerProfile => ({
  id,
  kind,
  name: `${kind} · ${id}`,
  values,
  isDefault,
  login: null,
  expiresAt: null,
})

const hulyOnly = (values: Record<string, string>): ProfileSet => ({ profiles: [profile('work', 'huly', values)], links: {} })

function context() {
  const started: { view: TrackerView; setup: TrackerSetup; handle: TrackerHandle & { updates: TrackerSetup[]; stopped: boolean } }[] = []
  const start = vi.fn((view: TrackerView, setup: TrackerSetup) => {
    const handle = {
      updates: [] as TrackerSetup[],
      stopped: false,
      update(next: TrackerSetup) {
        this.updates.push(next)
      },
      stop() {
        this.stopped = true
      },
    }
    started.push({ view, setup, handle })
    return handle
  })
  const tasksByProject = new Map<string, never[]>()
  const refreshers = new Map<string, () => Promise<void>>()
  const log = vi.fn<(line: string) => void>()
  const trackers = new Trackers({ adapters: { huly, github }, start, tasksByProject, refreshers, log })
  return { trackers, started, start, tasksByProject, refreshers, log }
}

describe('trackerPlans', () => {
  it('gives each profile its projects, sorted, and their names in it; the default profile of the default tracker is there without projects', () => {
    const set: ProfileSet = { profiles: [profile('work', 'huly', {}), profile('octo', 'github', {})], links: {} }
    const plans = trackerPlans(config({ trackers: { XYZ: 'github', ABC: 'github' }, trackerProjects: { XYZ: 'octo/xyz', ABC: 'octo/abc' } }), set)
    expect(plans.get('work')).toMatchObject({ kind: 'huly', projects: [], places: {} })
    expect(plans.get('octo')).toMatchObject({
      kind: 'github',
      projects: ['ABC', 'XYZ'],
      places: { ABC: { key: 'ABC', value: 'octo/abc' }, XYZ: { key: 'XYZ', value: 'octo/xyz' } },
    })
  })

  it('gives the adapter the key of each project by its id: two projects may share one (BTN-271)', () => {
    const plans = trackerPlans(
      config({ projects: { 'id-a': 'D:/a', 'id-b': 'D:/b' }, keys: { 'id-a': 'ABC', 'id-b': 'ABC' }, trackers: { 'id-a': 'huly', 'id-b': 'huly' }, trackerProjects: { 'id-b': 'XYZ' } }),
      hulyOnly({}),
    )
    expect(plans.get('work')?.places).toEqual({ 'id-a': { key: 'ABC' }, 'id-b': { key: 'ABC', value: 'XYZ' } })
  })

  it('puts projects whose tracker has no profile under one key of the tracker', () => {
    const plans = trackerPlans(config({ trackers: { ABC: 'github', XYZ: 'huly' } }), hulyOnly({}))
    expect([...plans.keys()]).toEqual(['work', 'none:github'])
    expect(plans.get('none:github')).toEqual({ kind: 'github', profile: undefined, projects: ['ABC'], places: { ABC: { key: 'ABC' } } })
  })
})

describe('Trackers', () => {
  it('starts a profile with projects, and keeps the setup of the default one for its links', () => {
    const { trackers, started } = context()
    trackers.apply(config(), hulyOnly({ HULY_TOKEN: 't1', HULY_URL: 'u' }))
    expect(started.map((each) => [each.view.name, each.view.kind, each.view.title, each.view.projects])).toEqual([['work', 'huly', 'huly · work', ['ABC', 'XYZ']]])
    expect(trackers.views()).toHaveLength(1)
    expect(trackers.setupOf(null)?.issueUrl(null)).toBe('https://t1/{id}')
    expect(trackers.keyOf('ABC')).toBe('work')
  })

  it('runs two profiles of one tracker for two projects, each with its own credentials', () => {
    const { trackers, started } = context()
    const set: ProfileSet = {
      profiles: [profile('personal', 'github', { GITHUB_TOKEN: 'g1' }), profile('org', 'github', { GITHUB_TOKEN: 'g2' }, false), profile('work', 'huly', {})],
      links: { XYZ: 'org' },
    }
    trackers.apply(config({ trackers: { ABC: 'github', XYZ: 'github' } }), set)
    expect(started.map((each) => [each.view.name, each.view.projects, each.setup.issueUrl(null)])).toEqual([
      ['personal', ['ABC'], 'https://g1'],
      ['org', ['XYZ'], 'https://g2'],
    ])
    expect([trackers.keyOf('ABC'), trackers.keyOf('XYZ')]).toEqual(['personal', 'org'])
    expect(trackers.setupOf('XYZ')?.issueUrl(null)).toBe('https://g2')
  })

  it('shows a tracker without a profile as off, and starts it once one appears', () => {
    const { trackers, started, log } = context()
    trackers.apply(config(), { profiles: [], links: {} })
    expect(started).toHaveLength(0)
    expect(trackers.views()[0]).toMatchObject({ name: 'none:huly', title: 'Huly', health: { state: 'off' } })
    expect(log).toHaveBeenCalledWith('Huly: ABC, XYZ have no profile, tracker is off')
    trackers.apply(config(), hulyOnly({ HULY_TOKEN: 't1', HULY_URL: 'u' }))
    expect(started).toHaveLength(1)
    expect(trackers.views().map((view) => view.name)).toEqual(['work'])
  })

  it('reconnects with new credentials rather than starting the tracker again, and reads its projects anew', () => {
    const { trackers, started, refreshers } = context()
    const refresh = vi.fn(async () => {})
    refreshers.set('ABC', refresh)
    trackers.apply(config(), hulyOnly({ HULY_TOKEN: 't1', HULY_URL: 'u' }))
    trackers.apply(config(), hulyOnly({ HULY_TOKEN: 't2', HULY_URL: 'u' }))
    expect(started).toHaveLength(1)
    expect(started[0]!.handle.updates.map((setup) => setup.issueUrl(null))).toEqual(['https://t2/{id}'])
    expect(refresh).toHaveBeenCalled()
  })

  it('a renamed profile keeps its connection and shows the new name', () => {
    const { trackers, started } = context()
    const set = hulyOnly({ HULY_TOKEN: 't1', HULY_URL: 'u' })
    trackers.apply(config(), set)
    trackers.apply(config(), { ...set, profiles: [{ ...set.profiles[0]!, name: 'Work' }] })
    expect(started).toHaveLength(1)
    expect(started[0]!.handle.updates).toEqual([])
    expect(trackers.views()[0]?.title).toBe('Work')
  })

  it('stops the tracker once its profile is gone, and leaves it off', () => {
    const { trackers, started } = context()
    trackers.apply(config(), hulyOnly({ HULY_TOKEN: 't1', HULY_URL: 'u' }))
    trackers.apply(config(), { profiles: [], links: {} })
    expect(started[0]!.handle.stopped).toBe(true)
    expect(trackers.views()[0]?.health.state).toBe('off')
    expect(trackers.setupOf('ABC')).toBeUndefined()
  })

  it('turns a tracker off and says why when its profile is set only in part', () => {
    const { trackers, started, log } = context()
    trackers.apply(config(), hulyOnly({ HULY_TOKEN: 't1', HULY_URL: 'u' }))
    trackers.apply(config(), hulyOnly({ HULY_TOKEN: 't1' }))
    expect(started[0]!.handle.stopped).toBe(true)
    expect(log).toHaveBeenCalledWith('huly · work: HULY_TOKEN and HULY_URL go together, tracker is off')
  })

  it('starts the tracker again for a project added or moved, and forgets the tasks of a project that left it', () => {
    const { trackers, started, tasksByProject } = context()
    const set: ProfileSet = { profiles: [profile('work', 'huly', { HULY_TOKEN: 't1', HULY_URL: 'u' }), profile('octo', 'github', { GITHUB_TOKEN: 'g' })], links: {} }
    trackers.apply(config({ projects: { ABC: 'D:/abc' }, trackers: { ABC: 'huly' } }), set)
    tasksByProject.set('ABC', [])
    trackers.apply(config(), set)
    expect(started.map((each) => each.view.projects)).toEqual([['ABC'], ['ABC', 'XYZ']])
    expect(started[0]!.handle.stopped).toBe(true)
    expect(tasksByProject.has('ABC')).toBe(true)
    trackers.apply(config({ trackers: { ABC: 'github', XYZ: 'huly' }, trackerProjects: { ABC: 'octo/abc' } }), set)
    expect(started.map((each) => [each.view.name, each.view.projects])).toEqual([
      ['work', ['ABC']],
      ['work', ['ABC', 'XYZ']],
      ['work', ['XYZ']],
      ['octo', ['ABC']],
    ])
    expect(tasksByProject.has('ABC')).toBe(false)
  })

  it('stops a tracker left without projects', () => {
    const { trackers, started } = context()
    const set = hulyOnly({ HULY_TOKEN: 't1', HULY_URL: 'u' })
    trackers.apply(config(), set)
    trackers.apply(config({ projects: {}, trackers: {} }), set)
    expect(started[0]!.handle.stopped).toBe(true)
    expect(trackers.views()).toEqual([])
    expect(trackers.setupOf(null)).toBeDefined()
  })
})
