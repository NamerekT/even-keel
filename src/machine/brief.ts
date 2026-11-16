import type { CheckReport } from '../chain/checkreports.js'
import { isCarryName, isFixName, projectOfCarry, projectOfFix } from '../chain/fix.js'
import { parseConfig, type EvenKeelConfig } from '../config.js'
import type { WarmTask } from '../sessions/keepwarm.js'
import type { TaskRun } from '../sessions/runs.js'

/** The hub's command that hands the machine what only the hub knows (`docs/machines.md`, "The brief"). */
export const BRIEF_COMMAND = 'hub.brief'

/**
 * What the machine's assembly reads of the hub: its config, with the machine's own folder for each project it serves,
 * and the parts of the chain's state and the trackers' lists a launch, a move or keep-warm asks about.
 */
export interface HubBrief {
  /** Running projects, including their pause state, for account sign-in protection. */
  active?: { project: string; paused: boolean }[]
  /** Routes whose servers belong to the hub; never their targets or credentials. */
  hubServers?: string[]
  trackers?: Record<string, { server: string; required: boolean; also?: string }>
  /** The hub's config; `projects` holds only the machine's projects, each with its folder on the machine. */
  config: EvenKeelConfig
  /** By project, the tasks with a run of their own (`TaskRuns.ofProject`). */
  runs: Record<string, Record<string, TaskRun>>
  /** By project, the ids of the tasks its trackers list, in no particular order. */
  tasks: Record<string, string[]>
  /** The current task of each running chain, with its project: a task the lists no longer have. */
  current: Record<string, string>
  /** The projects of the demo (BTN-776), which run on its own model. */
  demo: string[]
  unattended: boolean
  trimTools: boolean
  /** The sessions keep-warm pings (`warmTasks`). */
  warm: WarmTask[]
  /** By project and task, what the check before the merge reported (EKR-103). */
  reports: Record<string, Record<string, CheckReport>>
}

/** A brief with nothing in it: what the machine holds until the hub's first one comes. */
export function emptyBrief(): HubBrief {
  return { config: parseConfig({ projects: [] }), runs: {}, tasks: {}, current: {}, demo: [], unattended: false, trimTools: false, warm: [], reports: {} }
}

/**
 * The machine's copy of the hub's brief: the last one the hub sent, replaced whole. Until the first one the machine
 * holds an empty config, and `received` is `false`: the machine does not say it has read its accounts, so no chain steps.
 */
export class BriefCopy {
  private brief: HubBrief = emptyBrief()
  private taken = false

  take(brief: HubBrief): void {
    this.brief = brief
    this.taken = true
  }

  get received(): boolean {
    return this.taken
  }

  /** The config as the machine runs on it: the hub's, with the machine's folders. Read live: a new brief replaces it. */
  readonly configStore: { readonly current: EvenKeelConfig }

  constructor() {
    const read = () => this.brief.config
    this.configStore = { get current() { return read() } }
  }

  get unattended(): boolean {
    return this.brief.unattended
  }

  get trimTools(): boolean {
    return this.brief.trimTools
  }

  active(): { project: string; paused: boolean }[] { return this.brief.active ?? [] }
  hubServers(): string[] { return this.brief.hubServers ?? [] }
  tracker(project: string) { return this.brief.trackers?.[project] }

  warm(): WarmTask[] {
    return this.brief.warm
  }

  runOf(project: string | undefined, task: string): TaskRun | undefined {
    return project === undefined ? undefined : this.brief.runs[project]?.[task]
  }

  /** Whether the hub has read the project's tasks: an empty list is a list too. */
  lists(project: string): boolean {
    return Object.hasOwn(this.brief.tasks, project)
  }

  tasksOf(project: string): string[] {
    return this.brief.tasks[project] ?? []
  }

  demoOwns(project: string | undefined): boolean {
    return project !== undefined && this.brief.demo.includes(project)
  }

  report(project: string, task: string): CheckReport | undefined {
    return this.brief.reports[project]?.[task]
  }

  reported(project: string): string[] {
    return Object.keys(this.brief.reports[project] ?? {})
  }

  /** The project of a task: the one whose list has it, else the project a fix or carry name gives, else a chain's current one. */
  projectOf(task: string): string | undefined {
    const { tasks, config, current } = this.brief
    for (const [project, ids] of Object.entries(tasks)) if (ids.includes(task)) return project
    const fixed = isFixName(task)
      ? projectOfFix(config.keys, task)
      : isCarryName(task)
        ? projectOfCarry(config.keys, (from) => config.settings[from]?.mergeInto ?? undefined, task)
        : undefined
    return fixed ?? current[task]
  }
}
