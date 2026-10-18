import { describe, expect, it, vi } from 'vitest'
import type { TrackerView } from './health.js'
import type { TrackerAdapter, TrackerSetup } from './source.js'
import type { TrackerHandle } from './start.js'
import { trackerPlans, Trackers, type TrackerConfig } from './trackers.js'

const setupOf = (token: string): TrackerSetup => ({ connect: async () => Promise.reject(new Error(token)), issueUrl: () => `https://${token}/{id}` })

const huly: TrackerAdapter = {
  title: 'Huly',
  variables: ['HULY_TOKEN', 'HULY_URL'],
  setup: (env) => {
    if (env.HULY_TOKEN === undefined && env.HULY_URL === undefined) return undefined
    if (env.HULY_TOKEN === undefined || env.HULY_URL === undefined) throw new Error('HULY_TOKEN and HULY_URL go together')
    return setupOf(env.HULY_TOKEN)
  },
}
const github: TrackerAdapter = {
  title: 'GitHub',
  variables: ['GITHUB_TOKEN'],
  setup: (env, projects) => (env.GITHUB_TOKEN === undefined ? undefined : { ...setupOf(env.GITHUB_TOKEN), issueUrl: (project) => (project === null ? null : (projects[project] ?? null)) }),
}

const config = (more: Partial<TrackerConfig> = {}): TrackerConfig => ({
  projects: { ABC: 'D:/abc', XYZ: 'D:/xyz' },
  tracker: 'huly',
  trackers: { ABC: 'huly', XYZ: 'huly' },
  trackerProjects: {},
  ...more,
})

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
  it('gives each tracker its projects, sorted, and their names in it; the default tracker is there without projects', () => {
    const plans = trackerPlans(config({ trackers: { XYZ: 'github', ABC: 'github' }, trackerProjects: { XYZ: 'octo/xyz', ABC: 'octo/abc' } }))
    expect(plans.get('huly')).toEqual({ projects: [], names: {} })
    expect(plans.get('github')).toEqual({ projects: ['ABC', 'XYZ'], names: { ABC: 'octo/abc', XYZ: 'octo/xyz' } })
  })
})

describe('Trackers', () => {
  it('starts a tracker with projects and variables, and keeps the setup of the default one for its links', () => {
    const { trackers, started } = context()
    trackers.apply(config(), { HULY_TOKEN: 't1', HULY_URL: 'u' })
    expect(started.map((each) => each.view.projects)).toEqual([['ABC', 'XYZ']])
    expect(trackers.views()).toHaveLength(1)
    expect(trackers.setup('huly')?.issueUrl(null)).toBe('https://t1/{id}')
  })

  it('shows a tracker without its variables as off, and starts it once they appear', () => {
    const { trackers, started, log } = context()
    trackers.apply(config(), {})
    expect(started).toHaveLength(0)
    expect(trackers.views()[0]?.health.state).toBe('off')
    expect(log).toHaveBeenCalledWith('huly: HULY_TOKEN, HULY_URL not set, tracker is off')
    trackers.apply(config(), { HULY_TOKEN: 't1', HULY_URL: 'u' })
    expect(started).toHaveLength(1)
  })

  it('reconnects with new credentials rather than starting the tracker again, and reads its projects anew', () => {
    const { trackers, started, refreshers } = context()
    const refresh = vi.fn(async () => {})
    refreshers.set('ABC', refresh)
    trackers.apply(config(), { HULY_TOKEN: 't1', HULY_URL: 'u' })
    trackers.apply(config(), { HULY_TOKEN: 't2', HULY_URL: 'u' })
    expect(started).toHaveLength(1)
    expect(started[0]!.handle.updates.map((setup) => setup.issueUrl(null))).toEqual(['https://t2/{id}'])
    expect(refresh).toHaveBeenCalled()
  })

  it('does nothing when neither its projects nor its variables changed', () => {
    const { trackers, started } = context()
    trackers.apply(config(), { HULY_TOKEN: 't1', HULY_URL: 'u', OTHER: 'a' })
    trackers.apply(config(), { HULY_TOKEN: 't1', HULY_URL: 'u', OTHER: 'b' })
    expect(started).toHaveLength(1)
    expect(started[0]!.handle.updates).toEqual([])
  })

  it('stops the tracker once its variables are removed, and leaves it off', () => {
    const { trackers, started } = context()
    trackers.apply(config(), { HULY_TOKEN: 't1', HULY_URL: 'u' })
    trackers.apply(config(), {})
    expect(started[0]!.handle.stopped).toBe(true)
    expect(trackers.views()[0]?.health.state).toBe('off')
    expect(trackers.setup('huly')).toBeUndefined()
  })

  it('turns a tracker off and says why when its variables are set only in part', () => {
    const { trackers, started, log } = context()
    trackers.apply(config(), { HULY_TOKEN: 't1', HULY_URL: 'u' })
    trackers.apply(config(), { HULY_TOKEN: 't1' })
    expect(started[0]!.handle.stopped).toBe(true)
    expect(log).toHaveBeenCalledWith('huly: HULY_TOKEN and HULY_URL go together, tracker is off')
  })

  it('starts the tracker again for a project added or moved, and forgets the tasks of a project that left it', () => {
    const { trackers, started, tasksByProject } = context()
    const env = { HULY_TOKEN: 't1', HULY_URL: 'u', GITHUB_TOKEN: 'g' }
    trackers.apply(config({ projects: { ABC: 'D:/abc' }, trackers: { ABC: 'huly' } }), env)
    tasksByProject.set('ABC', [])
    trackers.apply(config(), env)
    expect(started.map((each) => each.view.projects)).toEqual([['ABC'], ['ABC', 'XYZ']])
    expect(started[0]!.handle.stopped).toBe(true)
    expect(tasksByProject.has('ABC')).toBe(true)
    trackers.apply(config({ trackers: { ABC: 'github', XYZ: 'huly' }, trackerProjects: { ABC: 'octo/abc' } }), env)
    expect(started.map((each) => [each.view.name, each.view.projects])).toEqual([
      ['huly', ['ABC']],
      ['huly', ['ABC', 'XYZ']],
      ['huly', ['XYZ']],
      ['github', ['ABC']],
    ])
    expect(tasksByProject.has('ABC')).toBe(false)
  })

  it('stops a tracker left without projects', () => {
    const { trackers, started } = context()
    const env = { HULY_TOKEN: 't1', HULY_URL: 'u' }
    trackers.apply(config(), env)
    trackers.apply(config({ projects: {}, trackers: {} }), env)
    expect(started[0]!.handle.stopped).toBe(true)
    expect(trackers.views()).toEqual([])
    expect(trackers.setup('huly')).toBeDefined()
  })
})
