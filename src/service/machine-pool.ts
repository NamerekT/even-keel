import type { Remote } from '../ci/remote.js'
import { JOIN_KIND, type JoinRequest } from '../jobs/model.js'
import type { JobPlan, StepDef } from '../jobs/runner.js'
import type { MachineProjectSettings } from '../link/view.js'
import { FOLDER_STEPS, throwOf, type FolderProbe, type FolderSpec } from '../machine/folder-check.js'
import { DRAFT_PROJECT } from '../machine/services.js'
import type { DraftMachine } from '../projects/state.js'
import { fail, notice, NoticeError } from '../notice/notice.js'
import { folderUnder, insideRoot, type MachineNetwork, type PoolTarget } from './machine-network.js'

/** The job's kind: the page's window names its steps (`machine-<step>`). */
export const CONNECT_KIND = 'machine'

export type PoolNetwork = Pick<MachineNetwork, 'target' | 'folders' | 'watchClone' | 'place' | 'unplace' | 'setEnabled'>

/** What the connection checks the machine's folder against: the project as the hub has it. */
export interface ProjectFacts {
  repo: string
  remotes: Remote[]
  /** The project's main branch (`branch`). */
  branch: string
  /** Claude Code runs the project's sessions. */
  claude: boolean
}

export interface ConnectDeps {
  network: PoolNetwork
  /** Read when the first step runs: a project the wizard is creating has none before. */
  factsOf: (project: string) => Promise<ProjectFacts>
  /** The hub's own machine. */
  own: () => string
}

export interface ConnectRequest {
  machine: string
  /** The folder on the machine; absent — the hub's folder name inside the machine's folder of projects. */
  folder?: string
  /**
   * The folder is made by a clone of the project's remote first; `auto` — the folder decides (BTN-1297): a clone into
   * a free one, a clone of the project already there taken as it is, anything else refused.
   */
  clone: boolean | 'auto'
  /** The machine becomes the project's only one: the wizard's choice of where a new project runs. */
  only?: boolean
  /** A machine of the pool whose own values in the project the machine takes, before the checks (BTN-994). */
  copyFrom?: string
}

/** The remote a machine clones from: `origin`, else the first. */
const cloneRemote = (remotes: Remote[]): Remote | undefined => remotes.find((remote) => remote.name === 'origin') ?? remotes[0]

/**
 * The steps that connect a machine elsewhere to a project (BTN-1271, `docs/machines.md`, "The pool on the page"): the
 * clone, if asked, the folder put into the pool turned off, the checks of the folder on the machine, and the machine
 * turned on. A failed check stops the job with what to do and Retry runs it again; Cancel takes the machine out of the
 * pool if the job put it there. A clone made stays on the machine. `project` is read when the steps run.
 */
export function connectSteps(deps: ConnectDeps, project: () => string, target: PoolTarget, request: ConnectRequest): { steps: StepDef[]; undo: () => Promise<void> } {
  let spec: FolderSpec | undefined
  let facts: ProjectFacts | undefined
  let inserted = false
  let enabled = false
  const prepared = async (): Promise<FolderSpec> => {
    if (spec !== undefined) return spec
    facts = await deps.factsOf(project())
    const folder = request.folder?.trim() || folderUnder(target.root, facts.repo)
    if (!insideRoot(folder, target.root)) throw fail('pool.outside', { folder, root: target.root })
    spec = { project: project(), folder, remotes: facts.remotes.map((remote) => remote.url), branch: facts.branch, claude: facts.claude }
    return spec
  }
  const clone: StepDef = {
    id: 'machine-clone',
    run: async ({ progress }) => {
      const each = await prepared()
      const remote = cloneRemote(facts!.remotes)
      if (remote === undefined) throw fail('pool.hubNoRemote', {})
      const folders = deps.network.folders(target)
      if (request.clone === 'auto') {
        const probe = await folders.probe({ project: each.project, folder: each.folder, remotes: each.remotes })
        if (probe.state === 'clone') return
        if (probe.state === 'taken') throw new NoticeError(probe.notice)
      }
      const stop = deps.network.watchClone(target.id, each.project, progress)
      try {
        await folders.clone(each, remote.url)
      } finally {
        stop()
        progress(undefined)
      }
    },
  }
  const place: StepDef = {
    id: 'machine-place',
    run: async () => {
      const each = await prepared()
      if (await deps.network.place(target, each.project, each.folder, request.copyFrom)) inserted = true
    },
  }
  const checks: StepDef[] = FOLDER_STEPS.map((step) => ({
    id: `machine-${step}`,
    run: async () => {
      const each = await prepared()
      throwOf(await deps.network.folders(target).check(step, each))
    },
  }))
  const enable: StepDef = {
    id: 'machine-enable',
    run: async () => {
      const each = await prepared()
      await deps.network.setEnabled(each.project, target.id, true)
      if (request.only === true) await deps.network.setEnabled(each.project, deps.own(), false)
      enabled = true
    },
  }
  return {
    steps: [...(request.clone !== false ? [clone] : []), place, ...checks, enable],
    // A project already connected stays: in a job over several, Cancel takes back only the rest.
    undo: async () => {
      if (inserted && !enabled && spec !== undefined) await deps.network.unplace(target.id, spec.project)
    },
  }
}

/**
 * The job of "Connect" in the window "Add a machine" (BTN-1263): the machine that joined connected to each project in
 * turn, by the same steps as "Connect" of a project's section "Machines", each step named `<step>@<project>`. A failed
 * step stops the job; Cancel takes back the projects not yet connected and keeps the rest.
 */
export async function joinPlan(deps: ConnectDeps, machine: string, requests: JoinRequest[]): Promise<JobPlan> {
  if (requests.length === 0) throw fail('request.projectList', {})
  const target = await deps.network.target(machine)
  const each = requests.map((request) => {
    const made = connectSteps(deps, () => request.project, target, { machine, clone: request.clone, ...(request.folder !== undefined && { folder: request.folder }) })
    return { steps: made.steps.map((step) => ({ ...step, id: `${step.id}@${request.project}` })), undo: made.undo }
  })
  return {
    kind: JOIN_KIND,
    subject: target.name,
    steps: each.flatMap((part) => part.steps),
    undo: async () => {
      for (const part of each) await part.undo()
    },
  }
}

/** The job of "Connect" in a project's section "Machines": a machine that cannot be connected starts none. */
export async function connectPlan(deps: ConnectDeps, project: string, request: ConnectRequest): Promise<JobPlan> {
  const target = await deps.network.target(request.machine)
  const { steps, undo } = connectSteps(deps, () => project, target, request)
  return { kind: CONNECT_KIND, subject: target.name, steps, undo, project }
}

/**
 * The wizard's project made to run on machines elsewhere (BTN-1297): after the project's own steps, each machine is
 * connected in turn, the folder deciding between a clone and a clone already there. Each machine's steps are a group:
 * one machine failing leaves the rest to go on, and Retry takes it up again. `here` false turns the hub's own machine
 * off as soon as a machine elsewhere is on. Cancel before the project is kept takes back all.
 */
export async function onMachines(deps: ConnectDeps, plan: JobPlan, machines: DraftMachine[], here: boolean): Promise<JobPlan> {
  const project = () => {
    const made = plan.result?.()
    if (made === undefined) throw new Error('the project is not made yet')
    return made
  }
  const each = await Promise.all(
    machines.map(async ({ machine, folder }) => {
      const target = await deps.network.target(machine)
      const made = connectSteps(deps, project, target, { machine, clone: 'auto', only: !here, ...(folder !== undefined && { folder }) })
      return { steps: made.steps.map((step) => ({ ...step, id: `${step.id}@${machine}`, group: machine })), undo: made.undo }
    }),
  )
  return {
    ...plan,
    steps: [...plan.steps, ...each.flatMap((part) => part.steps)],
    undo: async () => {
      for (const part of each) await part.undo()
      await plan.undo()
    },
  }
}

/**
 * What a folder on a machine elsewhere is to a project with the remote `remote` (BTN-1297), for the wizard before the
 * project is made: outside the machine's folder of projects it is refused here, never asked there.
 */
export async function probeOn(network: Pick<PoolNetwork, 'target' | 'folders'>, machine: string, folder: string, remote: string): Promise<FolderProbe> {
  const target = await network.target(machine)
  if (!insideRoot(folder, target.root)) return { state: 'taken', notice: notice('pool.outside', { folder, root: target.root }) }
  return network.folders(target).probe({ project: DRAFT_PROJECT, folder, remotes: [remote] })
}

export interface PoolControlDeps extends ConnectDeps {
  network: PoolNetwork & Pick<MachineNetwork, 'pool' | 'setSettings'>
  start: (plan: JobPlan) => void
}

/** What the page's section "Machines" asks of the hub (`ServerDeps.pool`). */
export function poolControl(deps: PoolControlDeps) {
  return {
    deps: deps as ConnectDeps,
    view: (project: string) => deps.network.pool(project),
    connect: async (project: string, request: ConnectRequest) => {
      deps.start(await connectPlan(deps, project, request))
    },
    enable: (project: string, machine: string, enabled: boolean) => deps.network.setEnabled(project, machine, enabled),
    settings: (project: string, machine: string, values: MachineProjectSettings) => deps.network.setSettings(project, machine, values),
    join: async (machine: string, requests: JoinRequest[]) => {
      deps.start(await joinPlan(deps, machine, requests))
    },
    probe: (machine: string, folder: string, remote: string) => probeOn(deps.network, machine, folder, remote),
  }
}
