import type { EvenKeelConfig } from '../config.js'
import { defaultProfile, profileFor, type ProfileSet, type TrackerProfile } from '../profiles/model.js'
import type { TrackerView } from './health.js'
import type { TrackerAdapter, TrackerPlace, TrackerSetup } from './source.js'
import type { TrackerHandle } from './start.js'

export type TrackerConfig = Pick<EvenKeelConfig, 'projects' | 'keys' | 'trackers' | 'trackerProjects'>

/** What one profile of a tracker serves: its projects, sorted, and the place of each in the tracker. */
export interface TrackerPlan {
  kind: string
  /** `undefined` — the tracker has projects but no profile to run them on. */
  profile: TrackerProfile | undefined
  projects: string[]
  places: Record<string, TrackerPlace>
}

/** The key of a tracker that has projects and no profile. */
export const noProfile = (kind: string): string => `none:${kind}`

/**
 * A plan per profile the projects run on, by the profile's id; a tracker whose projects have no profile gets one by
 * `noProfile`. The default profile of the links' tracker (`linksTracker`) is there even when no project runs on it: its
 * setup gives the links of tasks whose project is not known.
 */
export function trackerPlans(config: TrackerConfig, set: ProfileSet): Map<string, TrackerPlan> {
  const plans = new Map<string, TrackerPlan>()
  const planOf = (kind: string, profile: TrackerProfile | undefined): TrackerPlan => {
    const key = profile?.id ?? noProfile(kind)
    const plan = plans.get(key) ?? { kind, profile, projects: [], places: {} }
    plans.set(key, plan)
    return plan
  }
  const links = linksTracker(config)
  const fallback = links === undefined ? undefined : defaultProfile(set, links)
  if (links !== undefined && fallback !== undefined) planOf(links, fallback)
  for (const project of Object.keys(config.projects).sort()) {
    const kind = config.trackers[project]!
    const plan = planOf(kind, profileFor(set, project, kind))
    plan.projects.push(project)
    const value = config.trackerProjects[project]
    plan.places[project] = { key: config.keys[project] ?? project, ...(value === undefined ? {} : { value }) }
  }
  return plans
}

/**
 * The tracker whose default profile links a task of no known project: the one most projects run on, a tie going to the
 * first project's in the order of the config; none without projects. It took the shared `tracker` before BTN-345.
 */
export function linksTracker(config: Pick<TrackerConfig, 'projects' | 'trackers'>): string | undefined {
  const counts = new Map<string, number>()
  for (const project of Object.keys(config.projects)) {
    const kind = config.trackers[project]!
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  let best: string | undefined
  for (const [kind, count] of counts) if (best === undefined || count > counts.get(best)!) best = kind
  return best
}

export interface TrackersDeps {
  adapters: Readonly<Record<string, TrackerAdapter>>
  /** `startTracker` with the rest of its deps bound. */
  start: (view: TrackerView, setup: TrackerSetup) => TrackerHandle
  /** By reader: a project or one of its feeds (BTN-66). */
  tasksByProject: { delete(project: string): void }
  refreshers: Map<string, () => Promise<void>>
  log: (line: string) => void
}

interface Running {
  /** The projects and the profile's values it was set up with. */
  projects: string
  signature: string
  view: TrackerView | undefined
  handle: TrackerHandle | undefined
}

/**
 * The trackers the service runs, one per profile, brought in line with the config and the profiles on the fly: a
 * profile's tracker starts once it has projects, reconnects when only its credentials or its projects' names in it
 * changed, starts again for a project added or moved, and stops when its profile or projects are gone.
 */
export class Trackers {
  private readonly setups = new Map<string, TrackerSetup | undefined>()
  private readonly running = new Map<string, Running>()
  /** The plan key of each project, and of the links' tracker's default profile. */
  private keys = new Map<string, string>()
  private defaultKey: string | undefined

  constructor(private readonly deps: TrackersDeps) {}

  views(): TrackerView[] {
    return [...this.running.values()].flatMap((each) => (each.view === undefined ? [] : [each.view]))
  }

  /** The key of the tracker that runs the project: the key of its link. */
  keyOf(project: string): string | undefined {
    return this.keys.get(project)
  }

  /** The setup of the project's profile; without a project, of the default profile of the links' tracker (`linksTracker`). */
  setupOf(project: string | null): TrackerSetup | undefined {
    const key = project === null ? this.defaultKey : this.keys.get(project)
    return key === undefined ? undefined : this.setups.get(key)
  }

  apply(config: TrackerConfig, set: ProfileSet): void {
    const plans = trackerPlans(config, set)
    for (const key of [...this.running.keys()]) {
      if (plans.has(key)) continue
      this.retire(key, [])
      this.running.delete(key)
      this.setups.delete(key)
    }
    this.keys = new Map([...plans].flatMap(([key, plan]) => plan.projects.map((project): [string, string] => [project, key])))
    const links = linksTracker(config)
    this.defaultKey = links === undefined ? undefined : defaultProfile(set, links)?.id
    for (const [key, plan] of plans) this.applyOne(key, plan)
  }

  private applyOne(key: string, plan: TrackerPlan): void {
    const adapter = this.deps.adapters[plan.kind]!
    const title = plan.profile?.name ?? adapter.title
    const values = plan.profile?.values ?? {}
    const projects = JSON.stringify(plan.projects)
    const signature = JSON.stringify({ values: adapter.variables.map((variable) => values[variable] ?? null), places: plan.places })
    const before = this.running.get(key)
    if (before?.view !== undefined) before.view.title = title
    if (before?.projects === projects && before.signature === signature) return
    let setup: TrackerSetup | undefined
    let failed = false
    try {
      setup = adapter.setup(values, plan.places)
    } catch (error) {
      failed = true
      this.deps.log(`${title}: ${(error as Error).message}, tracker is off`)
    }
    this.setups.set(key, setup)
    if (before?.projects === projects && before.handle !== undefined && setup !== undefined) {
      before.handle.update(setup)
      this.running.set(key, { ...before, signature })
      this.deps.log(`${title}: its credentials changed, the tracker connects again`)
      for (const project of plan.projects) void this.deps.refreshers.get(project)?.()
      return
    }
    this.retire(key, plan.projects)
    if (plan.projects.length === 0) {
      this.running.set(key, { projects, signature, view: undefined, handle: undefined })
      return
    }
    const view: TrackerView = {
      name: key,
      kind: plan.kind,
      title,
      projects: plan.projects,
      ready: false,
      relabel: false,
      health: { state: 'off', lastOkAt: null, error: null },
      readAt: {},
    }
    if (plan.profile === undefined) this.deps.log(`${title}: ${plan.projects.join(', ')} have no profile, tracker is off`)
    else if (setup === undefined && !failed) this.deps.log(`${title}: the profile has no credentials, tracker is off`)
    const handle = setup === undefined ? undefined : this.deps.start(view, setup)
    this.running.set(key, { projects, signature, view, handle })
  }

  /** Stops the tracker; the tasks of its projects that are not in `staying` go: another tracker reads them, or none. */
  private retire(key: string, staying: string[]): void {
    const before = this.running.get(key)
    before?.handle?.stop()
    for (const project of before?.view?.projects ?? []) if (!staying.includes(project)) this.deps.tasksByProject.delete(project)
  }
}
