import type { EvenKeelConfig } from '../config.js'
import type { TrackerView } from './health.js'
import type { TrackerAdapter, TrackerSetup } from './source.js'
import type { TrackerHandle } from './start.js'

export type TrackerConfig = Pick<EvenKeelConfig, 'projects' | 'tracker' | 'trackers' | 'trackerProjects'>

/** What a tracker serves: its projects, sorted, and the name of each in the tracker, for those that have one. */
export interface TrackerPlan {
  projects: string[]
  names: Record<string, string>
}

/** Every tracker the config names, the default one too, even without projects: its setup gives the links of other projects' tasks. */
export function trackerPlans(config: TrackerConfig): Map<string, TrackerPlan> {
  const plans = new Map<string, TrackerPlan>()
  for (const name of [config.tracker, ...Object.values(config.trackers)]) {
    if (plans.has(name)) continue
    const projects = Object.keys(config.projects)
      .filter((project) => config.trackers[project] === name)
      .sort()
    const names = Object.fromEntries(projects.flatMap((project) => (project in config.trackerProjects ? [[project, config.trackerProjects[project]!]] : [])))
    plans.set(name, { projects, names })
  }
  return plans
}

export interface TrackersDeps {
  adapters: Readonly<Record<string, TrackerAdapter>>
  /** `startTracker` with the rest of its deps bound. */
  start: (view: TrackerView, setup: TrackerSetup) => TrackerHandle
  tasksByProject: Map<string, unknown>
  refreshers: Map<string, () => Promise<void>>
  log: (line: string) => void
}

interface Running {
  /** The projects and the variables' values it was set up with. */
  projects: string
  signature: string
  view: TrackerView | undefined
  handle: TrackerHandle | undefined
}

/**
 * The trackers the service runs, brought in line with the config and the environment on the fly: a tracker starts once it
 * has projects and variables, reconnects when only its credentials or its projects' names in it changed, starts again for
 * a project added or moved, and stops when its variables or projects are gone.
 */
export class Trackers {
  private readonly setups = new Map<string, TrackerSetup | undefined>()
  private readonly running = new Map<string, Running>()

  constructor(private readonly deps: TrackersDeps) {}

  views(): TrackerView[] {
    return [...this.running.values()].flatMap((each) => (each.view === undefined ? [] : [each.view]))
  }

  setup(name: string): TrackerSetup | undefined {
    return this.setups.get(name)
  }

  apply(config: TrackerConfig, env: Record<string, string | undefined>): void {
    const plans = trackerPlans(config)
    for (const name of [...this.running.keys()]) {
      if (plans.has(name)) continue
      this.retire(name, [])
      this.running.delete(name)
      this.setups.delete(name)
    }
    for (const [name, plan] of plans) this.applyOne(name, plan, env)
  }

  private applyOne(name: string, plan: TrackerPlan, env: Record<string, string | undefined>): void {
    const adapter = this.deps.adapters[name]!
    const projects = JSON.stringify(plan.projects)
    const signature = JSON.stringify({ values: adapter.variables.map((variable) => env[variable] ?? null), names: plan.names })
    const before = this.running.get(name)
    if (before?.projects === projects && before.signature === signature) return
    let setup: TrackerSetup | undefined
    let failed = false
    try {
      setup = adapter.setup(env, plan.names)
    } catch (error) {
      failed = true
      this.deps.log(`${name}: ${(error as Error).message}, tracker is off`)
    }
    this.setups.set(name, setup)
    if (before?.projects === projects && before.handle !== undefined && setup !== undefined) {
      before.handle.update(setup)
      this.running.set(name, { ...before, signature })
      this.deps.log(`${name}: its variables changed, the tracker connects again`)
      for (const project of plan.projects) void this.deps.refreshers.get(project)?.()
      return
    }
    this.retire(name, plan.projects)
    if (plan.projects.length === 0) {
      this.running.set(name, { projects, signature, view: undefined, handle: undefined })
      return
    }
    const view: TrackerView = {
      name,
      title: adapter.title,
      projects: plan.projects,
      ready: false,
      health: { state: 'off', lastOkAt: null, error: null },
      readAt: {},
    }
    if (setup === undefined && !failed) this.deps.log(`${name}: ${adapter.variables.join(', ')} not set, tracker is off`)
    const handle = setup === undefined ? undefined : this.deps.start(view, setup)
    this.running.set(name, { projects, signature, view, handle })
  }

  /** Stops the tracker; the tasks of its projects that are not in `staying` go: another tracker reads them, or none. */
  private retire(name: string, staying: string[]): void {
    const before = this.running.get(name)
    before?.handle?.stop()
    for (const project of before?.view?.projects ?? []) if (!staying.includes(project)) this.deps.tasksByProject.delete(project)
  }
}
