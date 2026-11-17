import { hostname } from 'node:os'
import { chainOrder } from '../chain/order.js'
import type { LaunchEntry } from '../chain/dispatcher.js'
import { launchLine } from '../chain/log.js'
import { fileNote, keepHandoffNote, lastHandoffNote } from '../chain/handoff-notes.js'
import { saveSnapshot } from '../chain/snapshots.js'
import { AccountPolls } from '../limits/polls.js'
import { listenOf, localUrlOf, runSettings } from '../config.js'
import { root } from '../locations.js'
import { installed } from '../updates/watcher.js'
import { machinesPortOf } from '../link/address.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { hubIdentity } from '../link/identity.js'
import { MachineNetwork } from './machine-network.js'
import { HubEnd } from '../link/hub.js'
import { LOCAL_HEARTBEAT_MS, LocalTransport } from '../link/local.js'
import { DatabaseMachineStore, MACHINE_DIR } from '../link/machine-store.js'
import { bearerOf, type MachineEvent } from '../link/protocol.js'
import type { HandoffSnapshot } from '../chain/snapshots.js'
import type { Notice } from '../notice/notice.js'
import { Assignments, fillPool } from '../machine/assignments.js'
import { ownMachine } from '../machine/own.js'
import { folderMarks } from '../machine/marks.js'
import type { FolderOwner, MachineEnd } from '../link/machine.js'
import type { PageReads } from '../machine/page.js'
import type { MachinePort } from '../machine/port.js'
import { RemoteMachine } from '../machine/remote.js'
import { machinePool } from '../machine/pool.js'
import { chainMachines } from '../machine/chain-machines.js'
import { movedText } from '../machine/reassign.js'
import { TaskMoves } from '../machine/task-moves.js'
import { PROMPTS } from '../chain/prompts.js'
import { Reassigner } from './reassign.js'
import type { ChainMachines } from '../chain/model.js'
import type { AssignedTask } from '../tracker/source.js'
import { LAUNCH_EVENT, type MachineRecords, saveMachineRecord } from '../machine/records.js'
import { SELECTION_EVENT, type MachineSelection } from '../machine/config.js'
import { settleMail } from '../sessions/mailRelay.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { servesTasks, TASKS_SERVER } from '../taskmcp/server.js'
import { samePath } from '../paths.js'
import { loadMail } from '../sessions/mailbox.js'
import type { MachineServices } from '../machine/services.js'
import { BriefSender, hubBrief } from './hub-brief.js'
import type { MachineContext } from './machine-context.js'
import { loadSessionWindows } from '../storage/context-windows.js'
import type { ChainContext } from './chain.js'
import type { ServiceContext } from '../service.js'
import { KEPT_WRITE_EVENT, type KeptWrite } from '../taskmcp/machine.js'
import { HubHooks } from './hub-hooks.js'
import { HubMcp } from './hub-mcp.js'
import { wireMachineSide } from './machine-side.js'

export { MACHINE_DIR }
/** How long the start waits for the machine's first snapshot; past it the chain simply does not step until it comes. */
const FIRST_SNAPSHOT_MS = 30_000
/** How often the machine posts what changed when no step of the chain asked for it: the page's actions read the mirror too. */
const PUBLISH_EVERY_MS = 5_000

export interface LinkedMachine {
  /** The hub's side of the port: what the chain is given, each call routed to the machine of its task (`machinePool`). */
  port: MachinePort
  /** The machines the chain's lanes run on (BTN-993). */
  machines: ChainMachines
  assignments: Assignments
  /** The tasks of machines gone and their move elsewhere by hand (BTN-1270). */
  reassigner: Reassigner
  records: MachineRecords
  /** What the page and the chat read of the machine's sessions and accounts: its mirror, never the machine's objects. */
  page: PageReads
  /** The hub's mirror of a machine, the own one too; `undefined` — one elsewhere that has not posted a snapshot since the hub started. */
  mirror(machine: string): RemoteMachine | undefined
  /** What the page, the hooks and the chat ask of the machine besides the chain: commands over the link. */
  services: MachineServices
  /** The door for machines elsewhere (BTN-1242): open while "Hub address for machines" is set. */
  network: MachineNetwork
  /**
   * Connects the machine to its hub and waits for its first snapshot. Called once the dispatcher exists: the machine's
   * facts read the chain's state. Until then the mirror is empty and the chains do not step.
   */
  start(): Promise<void>
  /** Stops both ends and closes the machine's database. */
  close(): Promise<void>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * A hub and its own machine in one process (`docs/machines.md`, "One process"): the chain's port is `RemoteMachine`,
 * the local port runs behind `MachineRunner`, and the two talk through `HubEnd` and `MachineEnd` over a carrier that
 * is a call. Nothing is connected until `start`.
 */
export async function wireLinkedMachine(ctx: ChainContext & Pick<ServiceContext, 'runsOfProject' | 'demo' | 'machineDb' | 'packageHub' | 'protectionAudit' | 'mailRelay'>, machine: MachineContext): Promise<LinkedMachine> {
  const log = (line: string): void => console.log(line)
  const { machineDb } = ctx
  const hubStore = new DatabaseHubStore(ctx.db)
  const machineStore = new DatabaseMachineStore(machineDb)
  let own = ''

  const moves = await TaskMoves.open({ db: ctx.db, writes: ctx.writes })
  const assignments = await Assignments.open({
    db: ctx.db,
    writes: ctx.writes,
    movedFrom: (project, task) => moves.from(project, task),
    order: (project) => {
      try {
        return chainOrder(ctx.tasksByProject.get(project) ?? [], ctx.dispatcher.state.orders[project])
      } catch {
        return []
      }
    },
  })

  let agreedFor = ''
  const marks = folderMarks(() => ({ machine: own, name: hostname() }), process.env)
  /** By project, the machine whose mark the person chose to take the folder over from: used at the next `agree`. */
  const takeOvers = new Map<string, string>()
  /** By project, the machine whose mark holds its folder; the machine's end refuses the project's commands by it. */
  const heldBy = new Map<string, FolderOwner>()
  let linked: MachineEnd | undefined
  /**
   * The machine serves the projects of its own installation, each in its folder; a project gone is served no longer,
   * and neither is one whose folder another machine's mark holds (`docs/machines.md`, "The folder's mark").
   */
  const agree = async (again = false): Promise<void> => {
    const { projects } = ctx.configStore.current
    const signature = JSON.stringify(projects)
    if (signature === agreedFor && !again) return
    for (const { project, folder } of await machineStore.consents()) {
      const repo = projects[project]
      if (repo === undefined || !samePath(repo, folder)) await machineStore.withdraw(project, folder)
    }
    for (const [project, repo] of Object.entries(projects)) {
      let owner = await marks.claim(repo, takeOvers.get(project))
      takeOvers.delete(project)
      // The mark of a machine this hub revoked is free: the own machine made anew takes the old one's folders this way.
      if (owner !== undefined && await network.holds(own, project, owner)) owner = await marks.claim(repo, owner.machine)
      if (owner === undefined) await network.holds(own, project, undefined)
      if (owner === undefined) heldBy.delete(project)
      else heldBy.set(project, owner)
      linked?.hold(project, owner)
      if (owner === undefined) await machineStore.agree(project, repo)
      else await machineStore.withdraw(project)
    }
    await fillPool(ctx.db, own, Object.keys(projects))
    await network.refresh()
    agreedFor = signature
  }

  const catchUp = async (): Promise<void> => {
    try {
      await agree()
      if (end.status().state !== 'online') return
      await briefs.send()
      await runner.publish()
      await end.flushed()
    } catch (error) {
      log(`machine: the hub could not catch up with its own machine: ${messageOf(error)}`)
    }
  }

  /** The hub's brief for a machine serving these projects, each in its folder there. */
  const briefOf = (folders: Record<string, string>) => hubBrief({
    config: () => ctx.configStore.current,
    folders: () => folders,
    runsOf: ctx.runsOfProject,
    tasksOf: (project) => (ctx.tasksByProject.get(project) ?? []).map((task) => task.id),
    state: () => ctx.dispatcher.state,
    demoOwns: (project) => ctx.demo.owns(project),
    reports: ctx.checkReports,
    hubServers: () => ctx.packageHub.hubServers(),
    tracker: (project) => {
      const adapter = ADAPTERS[ctx.configStore.current.trackers[project]!]!
      const server = adapter?.mcpServer
      return server === undefined ? undefined : { server, required: !ctx.briefOn(project), ...(server !== TASKS_SERVER && servesTasks(adapter) ? { also: TASKS_SERVER } : {}) }
    },
  })

  /** What the hub's port of any machine of its chain needs of the hub, the machine named. */
  const remoteOf = (machine: () => string) => ({
    projectOf: ctx.projectOf,
    projectOfSession: (sessionId: string) => ctx.launches.findLast((entry) => entry.sessionId === sessionId)?.project,
    lastSession: (project: string, task: string) => ctx.launches.findLast((entry) => entry.project === project && entry.task === task)?.sessionId,
    brief: async (project: string, task: string, retained?: boolean) => {
      const brief = await ctx.briefed.prepare(task, project, retained)
      const move = moves.of(project, task)
      if (move === undefined || move.launched) return brief
      const note = (await lastHandoffNote(ctx.db, project, task))?.note ?? null
      const text = movedText(PROMPTS[ctx.promptLanguage(project)], network.names()[move.from] ?? move.from, move.branch, note)
      return { ...brief, restore: { branch: move.branch, text } }
    },
    audit: (project: string) => ctx.protectionAudit.check(project),
    note: (project: string, task: string) => lastHandoffNote(ctx.db, project, task),
    saveSnapshot: async (snapshot: HandoffSnapshot) => {
      await saveSnapshot(ctx.db, snapshot)
      const note = fileNote(snapshot, ctx.projectOf(snapshot.task), machine())
      if (note !== undefined) await keepHandoffNote(ctx.db, note)
    },
    record: async (sent: MachineEvent) => {
      // Where the task is read from is the hub's to know (BTN-66): the machine's journal entry has no source.
      const event = sent.type === LAUNCH_EVENT ? { ...sent, payload: ctx.withSource(sent.payload as LaunchEntry) } : sent
      if (!await saveMachineRecord(ctx.db, machine(), event)) return
      if (event.type === LAUNCH_EVENT) {
        const entry = event.payload as LaunchEntry
        ctx.launches.push(entry)
        ctx.eventLog.launched(entry)
        log(launchLine(entry))
      }
      ctx.hub.broadcastSoon('state', () => ctx.getState())
    },
    leftover: (project: string, task: string, notice: Notice) => ctx.dispatcher.leftover(project, task, notice),
    transcript: (sessionId: string) => ctx.hub.signal('transcript', { sessionId }),
    assigned: (project: string, task: string) => {
      assignments.assign(project, task, machine())
      moves.launched(project, task)
    },
    released: (project: string, task: string) => {
      assignments.release(project, task)
      moves.drop(project, task)
    },
    held: (named: ReadonlySet<string>, live: AssignedTask[]) => assignments.reconcile(machine(), named, live),
    log,
  })

  const remote: RemoteMachine = new RemoteMachine({
    ...remoteOf(() => own),
    send: (machine, command) => hub.send(machine, command),
    machine: () => own,
    catchUp,
    stopped: (session) => {
      const launch = ctx.launches.findLast((entry) => entry.sessionId === session.sessionId)
      if (launch !== undefined) ctx.eventLog.stopped(launch.project, launch.task)
    },
    changed: () => {
      steerLimits()
      ctx.dispatcher.check()
      ctx.hub.broadcastSoon('state', () => ctx.getState())
    },
  })
  const polls = new AccountPolls({ hub: () => own, log })
  /** One poller per account and the newest limits for the others (`docs/machines.md`, "Account limits"). */
  const steerLimits = (): void => {
    const facts = remote.facts()
    if (facts === undefined) return
    const machines = [{ machine: own, online: hub.connected(own), identities: facts.identities ?? {}, limits: facts.limits }, ...network.accounts()]
    for (const [machine, plan] of polls.plan(machines)) {
      (machine === own ? remote.tellLimits(plan) : network.tellLimits(machine, plan)).catch((error: unknown) => {
        polls.connected(machine)
        log(`limits: the plan for machine ${machine} was not taken: ${messageOf(error)}`)
      })
    }
  }
  const hubMcp = new HubMcp({ db: ctx.db, origin: () => ctx.packageHub.hubOrigin, projects: () => Object.keys(ctx.configStore.current.projects), log })
  const hubHooks = new HubHooks({
    origin: () => localUrlOf(machine.listen),
    holder: (session): string | undefined => (remote.page.sessions().some((view) => view.sessionId === session) ? own : network.holderOf(session)),
    log,
  })
  const handlers = remote.handlers()
  const hub: HubEnd = new HubEnd({
    store: hubStore,
    handlers: {
      ...handlers,
      snapshot: (machine, snapshot) => {
        polls.connected(machine)
        // A new connection may be a new process of the machine, which holds no brief yet.
        briefs.forget()
        return handlers.snapshot(machine, snapshot)
      },
      offline: () => steerLimits(),
      event: async (machine, event) => {
        if (event.type === 'sessions.read') {
          void catchUp().then(() => settleMail(ctx.mailRelay)).catch((error: unknown) => log(`mail: ${messageOf(error)}`))
        } else if (event.type === SELECTION_EVENT) {
          const selection = event.payload as MachineSelection
          if (selection.kind === 'cli') ctx.configStore.saveCli(selection.provider, selection.value as 'checked' | 'system')
          else if (selection.kind === 'active') ctx.configStore.saveActive(selection.provider, selection.value)
          else ctx.configStore.saveSharedAccount(selection.provider, selection.value)
          await ctx.writes.settled()
        } else if (event.type === KEPT_WRITE_EVENT) await hubMcp.write(machine, event.payload as KeptWrite)
        else await handlers.event(machine, event)
      },
      mcp: (machine, request) => hubMcp.relay(machine, request),
    },
    log,
    heartbeatMs: LOCAL_HEARTBEAT_MS,
  })
  const token = await ownMachine({ hub, hubStore, db: ctx.db, machineDb, name: hostname() })
  own = token.machine
  const network = new MachineNetwork({
    db: ctx.db,
    store: hubStore,
    certificate: () => hubIdentity(ctx.db),
    own: () => own,
    address: () => ctx.configStore.current.machinesAddress,
    saveAddress: (address) => ctx.configStore.saveMachinesAddress(address),
    port: machinesPortOf(process.env),
    repoOf: (project) => ctx.configStore.current.projects[project],
    allowedHosts: () => ctx.configStore.current.allowedHosts,
    serviceHost: listenOf(process.env).host,
    version: installed(root).version,
    changed: () => ctx.hub.broadcast('machines', { changedAt: Date.now() }),
    peers: {
      remote: (machine) => remoteOf(() => machine),
      brief: briefOf,
      changed: () => {
        steerLimits()
        // The page shows each machine's accounts and its sign-in under way (`MachineNetwork.signIns`).
        ctx.hub.broadcastSoon('state', () => ctx.getState())
      },
      connected: (machine) => polls.connected(machine),
      mcp: (machine, request) => hubMcp.relay(machine, request),
      hook: (machine, request) => hubHooks.relay(machine, request),
      write: (machine, write) => hubMcp.write(machine, write),
    },
    takeOverOwn: async (project, owner) => {
      takeOvers.set(project, owner)
      await agree(true)
    },
    hubAccount: (key) => {
      const tie = remote.facts()?.identities?.[key]
      return tie === undefined ? undefined : { account: tie.account, email: tie.email }
    },
    log,
  })

  // The process before this one may have kept a command its machine never took: nothing waits for its result now, and a
  // launch among them would start a session the chain did not ask for again.
  const stale = await hubStore.commandsAfter(own, 0)
  if (stale.length > 0) {
    await hubStore.dropCommands(own, stale.at(-1)!.seq)
    log(`machine: ${stale.length} command(s) the service kept before its restart are dropped: ${stale.map((command) => command.type).join(', ')}`)
  }
  await agree()
  // The own machine serves every project of its installation, in its folder (`agree`).
  const briefs = new BriefSender(() => briefOf(ctx.configStore.current.projects), (brief) => remote.tellBrief(brief))

  const { end, runner, records, online: first, throughHub } = wireMachineSide(machine, {
    transport: new LocalTransport(hub, bearerOf(token)),
    store: machineStore,
    log,
  })
  linked = end
  for (const [project, owner] of heldBy) end.hold(project, owner)
  let publishing: ReturnType<typeof setInterval> | undefined
  const services = remote.services()
  const ownPort = remote.port()
  const pageOf = (machine: string): PageReads | undefined => (machine === own ? remote.page : network.remote(machine)?.page)
  const port = machinePool({
    own: () => own,
    port: (machine) => (machine === own ? ownPort : network.port(machine)),
    machineOf: (project, task) => assignments.machineOf(project, task),
    projectOf: ctx.projectOf,
    sessionMachine: (sessionId) => {
      if (remote.page.sessions().some((view) => view.sessionId === sessionId)) return own
      const holder = network.holderOf(sessionId)
      if (holder !== undefined) return holder
      const launch = ctx.launches.findLast((entry) => entry.sessionId === sessionId)
      return launch === undefined ? undefined : assignments.machineOf(launch.project, launch.task)
    },
    folderMachine: (folder) => (remote.page.sessions().some((view) => samePath(view.cwd, folder)) ? own : network.folderHolder(folder)),
  })
  const chain = chainMachines({
    own: () => own,
    parallel: () => ctx.configStore.current.parallel,
    peers: () => network.takers(),
    pool: (project) => network.poolOf(project),
    width: (project) => ctx.configStore.current.settings[project]?.width ?? 1,
    machineOf: (project, task) => assignments.machineOf(project, task),
    revoked: (machine) => network.revoked(machine),
    agentOf: (project, task) => ctx.runsOfProject(project)[task]?.provider ?? runSettings(ctx.configStore.current, project).provider,
    agents: (machine) => pageOf(machine)?.panel()?.accounts.map((entry) => entry.agent),
    movedFrom: (project, task) => moves.from(project, task),
    bind: (project, task, machine) => assignments.assign(project, task, machine),
  })
  const reassigner = new Reassigner({
    own: () => own,
    assignments,
    moves,
    connected: (machine) => network.connected(machine),
    names: () => network.names(),
    repoOf: (project) => ctx.configStore.current.projects[project],
    moved: (project, task) => ctx.dispatcher.moved(project, task),
    changed: () => ctx.hub.broadcastSoon('state', () => ctx.getState()),
    log,
  })

  return {
    port,
    machines: chain,
    assignments,
    reassigner,
    records,
    page: remote.page,
    mirror: (machine) => (machine === own ? remote : network.remote(machine)),
    services,
    network,
    start: async () => {
      await network.apply()
      await end.start()
      let waited: ReturnType<typeof setTimeout> | undefined
      await Promise.race([first, new Promise<void>((resolve) => (waited = setTimeout(resolve, FIRST_SNAPSHOT_MS)))])
      clearTimeout(waited)
      if (end.status().state !== 'online') log('machine: the own machine has not posted its first snapshot yet; the chains wait for it')
      else await briefs.send().catch((error: unknown) => log(`machine: the first brief was not taken: ${messageOf(error)}`))
      // From here the servers holding keys are reached over the link, as from a machine of its own (BTN-990).
      throughHub()
      await end.flushed()
      // The machine's journal, mailbox and windows are the hub's records, replayed ones included: handed over the link,
      // never read from the hub's database by the machine.
      await services.records.restore({ launches: ctx.launches, windows: await loadSessionWindows(ctx.db), mail: await loadMail(ctx.db) })
      // The machines elsewhere are caught up beside the own one, never inside a step of the chain.
      publishing = setInterval(() => {
        void catchUp()
        void network.catchUp()
      }, PUBLISH_EVERY_MS)
      publishing.unref()
    },
    close: async () => {
      clearInterval(publishing)
      await machine.writes.settled()
      await ctx.writes.settled()
      await end.flushed()
      end.stop()
      hub.stop()
      await network.close()
      await machineDb.close()
    },
  }
}
