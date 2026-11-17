import type { CheckReports } from '../chain/checkreports.js'
import type { ChainState } from '../chain/model.js'
import type { EvenKeelConfig } from '../config.js'
import type { MachineProjectSettings } from '../link/view.js'
import type { HubBrief } from '../machine/brief.js'
import { sameJson } from '../machine/facts.js'
import { warmTasks } from '../sessions/keepwarm.js'
import type { TaskRun } from '../sessions/runs.js'
import { settingsOnMachine } from './machine-settings.js'

export interface BriefSources {
  config: () => EvenKeelConfig
  /** The machine's projects, each with its folder there. */
  folders: () => Record<string, string>
  /** The machine's own values in its projects (BTN-994); a project left out has none. */
  machineSettings?: () => Record<string, MachineProjectSettings>
  runsOf: (project: string) => Record<string, TaskRun>
  tasksOf: (project: string) => string[]
  state: () => ChainState
  demoOwns: (project: string) => boolean
  reports: Pick<CheckReports, 'ofProject'>
  hubServers?: () => string[]
  tracker?: (project: string) => { server: string; required: boolean; also?: string } | undefined
}

/** What the machine's assembly reads of the hub now (`docs/machines.md`, "The brief"). */
export function hubBrief(sources: BriefSources): HubBrief {
  const config = sources.config()
  const folders = sources.folders()
  const projects = Object.keys(folders).filter((project) => Object.hasOwn(config.projects, project))
  const state = sources.state()
  const own = sources.machineSettings?.() ?? {}
  const byProject = <T>(read: (project: string) => T): Record<string, T> => Object.fromEntries(projects.map((project) => [project, read(project)]))
  const settings = { ...config.settings }
  for (const project of projects) if (own[project] !== undefined && settings[project] !== undefined) settings[project] = settingsOnMachine(settings[project], own[project])
  const servers = Object.fromEntries(projects.flatMap((project) => (own[project]?.servers === undefined ? [] : [[project, own[project].servers]])))
  const current: Record<string, string> = {}
  for (const chain of state.active) if (chain.current !== null && projects.includes(chain.project)) current[chain.current.task] = chain.project
  return {
    active: state.active.filter((chain) => projects.includes(chain.project)).map(({ project, paused }) => ({ project, paused })),
    hubServers: sources.hubServers?.() ?? [],
    trackers: Object.fromEntries(projects.flatMap((project) => { const tracker = sources.tracker?.(project); return tracker === undefined ? [] : [[project, tracker]] })),
    config: { ...config, projects: Object.fromEntries(projects.map((project) => [project, folders[project]!])), settings },
    servers,
    runs: byProject(sources.runsOf),
    tasks: byProject(sources.tasksOf),
    current,
    demo: projects.filter(sources.demoOwns),
    unattended: state.unattended,
    trimTools: state.trimTools,
    warm: warmTasks(state),
    reports: byProject((project) => sources.reports.ofProject(project)),
  }
}

/**
 * Sends the machine the hub's brief when it changed since the one it took. A failed send is sent again at the next
 * `send`; `forget` — a new connection of the machine, whose process may hold no brief at all.
 */
export class BriefSender {
  private sent: HubBrief | undefined
  private sending: Promise<void> = Promise.resolve()

  constructor(
    private readonly build: () => HubBrief,
    private readonly tell: (brief: HubBrief) => Promise<void>,
  ) {}

  send(): Promise<void> {
    const run = this.sending.then(async () => {
      const brief = this.build()
      if (this.sent !== undefined && sameJson(this.sent, brief)) return
      this.sent = brief
      try {
        await this.tell(brief)
      } catch (error) {
        this.sent = undefined
        throw error
      }
    })
    this.sending = run.catch(() => {})
    return run
  }

  forget(): void {
    this.sent = undefined
  }
}
