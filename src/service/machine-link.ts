import { hostname } from 'node:os'
import { heldLongToken } from '../account/longToken.js'
import { CLAUDE } from '../claude/name.js'
import { chainOrder } from '../chain/order.js'
import { isOpen } from '../tracker/model.js'
import type { CliSourceName } from '../agent/cli-state.js'
import type { LaunchEntry } from '../chain/dispatcher.js'
import { launchLine } from '../chain/log.js'
import { fileNote, keepHandoffNote, lastHandoffNote } from '../chain/handoff-notes.js'
import { saveSnapshot } from '../chain/snapshots.js'
import { AccountPolls } from '../limits/polls.js'
import { AccountIdentities } from '../limits/identity.js'
import { briefAccounts } from '../machine/account-here.js'
import { foldersHere } from './folders-here.js'
import { listenOf, localUrlOf, projectLabel, runSettings } from '../config.js'
import { fitWidths } from './width-cap.js'
import { inContainer, root, source } from '../locations.js'
import { headOf } from '../updates/checkout.js'
import { busyChains } from '../updates/settle.js'
import { installed } from '../updates/watcher.js'
import { machinesPortOf } from '../link/address.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { hubIdentity } from '../link/identity.js'
import { MachineNetwork } from './machine-network.js'
import { sessionTranscripts } from './session-transcripts.js'
import { folderGitCredentials, hubGitCredentials } from './git-credentials.js'
import { withCredentials } from '../git/credentials.js'
import { runGit } from '../git/run.js'
import { MachineTally } from '../stats/machine-tally.js'
import { HubEnd } from '../link/hub.js'
import { LOCAL_HEARTBEAT_MS, LocalTransport } from '../link/local.js'
import { DatabaseMachineStore, MACHINE_DIR } from '../link/machine-store.js'
import { bearerOf, type MachineEvent } from '../link/protocol.js'
import type { HandoffSnapshot } from '../chain/snapshots.js'
import { notice, type Notice } from '../notice/notice.js'
import { Assignments, fillPool } from '../machine/assignments.js'
import { ownMachine } from '../machine/own.js'
import { folderMarks } from '../machine/marks.js'
import type { FolderOwner, MachineEnd } from '../link/machine.js'
import type { HubBuild, MachineProjectSettings } from '../link/view.js'
import { allSessions, type PageReads, type SessionReads } from '../machine/page.js'
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
import { MAX_KEEP_WARM_HOURS } from '../sessions/keepwarm.js'
import { readWarmPings } from '../sessions/warm-pings.js'
import { adoptMail } from '../sessions/mailbox-store.js'
import type { MachineServices, TranscriptReads } from '../machine/services.js'
import { BriefSender, hubBrief } from './hub-brief.js'
import type { MachineContext } from './machine-context.js'
import { loadSessionWindows } from '../storage/context-windows.js'
import type { ChainContext } from './chain.js'
import type { ServiceContext } from '../service.js'
import { KEPT_WRITE_EVENT, type KeptWrite } from '../taskmcp/machine.js'
import { HubHooks } from './hub-hooks.js'
import { HubMcp } from './hub-mcp.js'
import { wireMachineSide } from './machine-side.js'
import { PoolAfterGreen } from './pool-after-green.js'
import { MachineUpdates } from './machine-updates.js'
import { DEFAULT_CI } from '../settings/defaults.js'

export { MACHINE_DIR }
/** How long the start waits for the machine's first snapshot; past it the chain simply does not step until it comes. */
const FIRST_SNAPSHOT_MS = 30_000
/** How often the machine posts what changed when no step of the chain asked for it: the page's actions read the mirror too. */
const PUBLISH_EVERY_MS = 5_000

export interface LinkedMachine {
  /** The checkout at this hub's start, also sent in a machine's version refusal. */
  hubCommit: string | null
  /** The hub's version and commit, the build the machines elsewhere come to (BTN-1609). */
  hubBuild: HubBuild
  /** The machines elsewhere's updates to the hub's build: "Update" on a machine's page. */
  updates: MachineUpdates
  /** The hub's side of the port: what the chain is given, each call routed to the machine of its task (`machinePool`). */
  port: MachinePort
  /** The commands after a green main on the machines elsewhere of each pool (BTN-994). */
  afterGreen: PoolAfterGreen
  /** The machines the chain's lanes run on (BTN-993). */
  machines: ChainMachines
  assignments: Assignments
  /** The tasks of machines gone and their move elsewhere by hand (BTN-1270). */
  reassigner: Reassigner
  records: MachineRecords
  /** What the page and the chat read of the machine's sessions and accounts: its mirror, never the machine's objects. */
  page: PageReads
  /** The sessions of every machine's mirror, the own one's first: the page's state of the tasks' sessions (BTN-1314). */
  sessions: SessionReads
  /** The hub's mirror of a machine, the own one too; `undefined` — one elsewhere that has not posted a snapshot since the hub started. */
  mirror(machine: string): RemoteMachine | undefined
  /** The own machine's id; empty until `wireLinkedMachine` read its token. */
  own(): string
  /** May the machine's call on `/tasks` without a project reach the project's tasks (`HubMcp.inPool`, BTN-1573)? */
  inPool(machine: string, project: string): Promise<boolean>
  /**
   * The merge closer's question about a task a machine elsewhere runs (BTN-1313): the own commits of its branches that
   * machine's main has; none while it is off the link, so a tracker's read never waits for it. `undefined` — the task
   * is the own machine's, or its machine has no port: the hub's checkout tells, as the pool falls back.
   */
  mergedElsewhere(project: string, task: string): Promise<string[]> | undefined
  /** What the page, the hooks and the chat ask of the machine besides the chain: commands over the link. */
  services: MachineServices
  /** The page's and the hooks' reads of a session's transcript, on the machine of the session (BTN-1574). */
  transcripts: TranscriptReads
  /** The door for machines elsewhere (BTN-1242): open while "Hub address for machines" is set. */
  network: MachineNetwork
  /** Whether a machine on the link polls `/usage` of the claude.ai account ("Account limits"). */
  polled(account: string): boolean
  /** The account's long-token windows differ from its full sign-in's poll (BTN-1267). */
  differs(account: string): boolean
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
export async function wireLinkedMachine(ctx: ChainContext & Pick<ServiceContext, 'runsOfProject' | 'demo' | 'machineDb' | 'packageHub' | 'protectionAudit' | 'mailRelay' | 'tally'>, machine: MachineContext): Promise<LinkedMachine> {
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

  const catchUp = async (whole = false): Promise<void> => {
    try {
      await agree()
      if (end.status().state !== 'online') return
      await briefs.send()
      await (whole ? runner.publish() : runner.refresh())
      await end.flushed()
    } catch (error) {
      log(`machine: the hub could not catch up with its own machine: ${messageOf(error)}`)
    }
  }

  /**
   * The hub's brief for a machine serving these projects, each in its folder there with its own values; a machine
   * elsewhere gets the hub's catalog of their packages too, the own one shares the hub's (BTN-1299).
   */
  const hubIdentities = new AccountIdentities()
  const briefOf = (folders: Record<string, string>, settings: Record<string, MachineProjectSettings> = {}, elsewhere = false) => {
    const routes = ctx.packageHub.hubServers()
    return hubBrief({
      config: () => ctx.configStore.current,
      folders: () => folders,
      machineSettings: () => settings,
      runsOf: ctx.runsOfProject,
      tasksOf: (project) => (ctx.tasksByProject.get(project) ?? []).map((task) => task.id),
      closedOf: (project) => (ctx.tasksByProject.get(project) ?? []).filter((task) => !isOpen(task.status)).map((task) => task.id),
      state: () => ctx.dispatcher.state,
      demoOwns: (project) => ctx.demo.owns(project),
      reports: ctx.checkReports,
      hubServers: () => routes,
      cliConsent: () => ctx.cliCopies.consented(),
      tracker: (project) => {
        const adapter = ADAPTERS[ctx.configStore.current.trackers[project]!]!
        const server = adapter?.mcpServer
        return server === undefined ? undefined : { server, required: !ctx.briefOn(project), ...(server !== TASKS_SERVER && servesTasks(adapter) ? { also: TASKS_SERVER } : {}) }
      },
      ...(elsewhere ? { catalog: (projects: string[]) => ctx.packages.catalogFor(projects, routes) } : {}),
      accounts: () => briefAccounts(foldersHere(ctx, hubIdentities)),
    })
  }

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
    briefNow: async () => {
      if (end.status().state !== 'online') return
      await briefs.send().catch((error: unknown) => log(`machine: the brief before a launch was not taken: ${messageOf(error)}`))
    },
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
  const hubMcp = new HubMcp({ db: ctx.db, origin: () => ctx.packageHub.hubOrigin, own: () => own, projects:() => Object.keys(ctx.configStore.current.projects), log })
  const machineTally = new MachineTally({ writer: () => ctx.tally.writer(), log })
  const hubHooks = new HubHooks({
    origin: () => localUrlOf(machine.listen),
    holder: (session): string | undefined => (remote.page.sessions().some((view) => view.sessionId === session) ? own : network.holderOf(session)),
    log,
  })
  const handlers = remote.handlers()
  const gitCredentialsOf = hubGitCredentials(ctx, log)
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
          if (selection.kind === 'cli') ctx.configStore.saveCli(selection.provider, selection.value as CliSourceName)
          else if (selection.kind === 'active') ctx.configStore.saveActive(selection.provider, selection.value)
          else ctx.configStore.saveSharedAccount(selection.provider, selection.value)
          await ctx.writes.settled()
        } else if (event.type === KEPT_WRITE_EVENT) await hubMcp.write(machine, event.payload as KeptWrite)
        else await handlers.event(machine, event)
      },
      mcp: (machine, request) => hubMcp.relay(machine, request),
      credentials: gitCredentialsOf,
    },
    log,
    heartbeatMs: LOCAL_HEARTBEAT_MS,
  })
  const token = await ownMachine({ hub, hubStore, db: ctx.db, machineDb, name: hostname() })
  own = token.machine
  // Read once: a push moves the checkout before the rebuild restarts this process on it.
  const hubCommit = source === 'git' ? await headOf(root) : null
  const hubVersion = installed(root).version
  // The machines elsewhere come to the hub's build once their lanes settle (BTN-1609).
  const hubBuild: HubBuild = { evenKeel: hubVersion, ...(hubCommit !== null && { commit: hubCommit }) }
  const updates = new MachineUpdates({
    hub: hubBuild,
    busy: (machine) => busyChains(ctx.dispatcher.state.active.filter((lane) => lane.machine === machine), new Date()),
    ask: (machine, build, force) => network.follow(machine, build, force),
    name: (machine) => network.names()[machine] ?? machine,
    notify: (told, machine) => ctx.eventLog.add({ level: 'warning', notice: told, place: { view: 'machine', machine } }),
    log,
  })
  const network = new MachineNetwork({
    ...(hubCommit !== null && { commit: hubCommit }),
    seen: (machine, about) => void updates.seen(machine, about).catch((error: unknown) => log(`machines: the build of machine ${machine} was not compared: ${String(error)}`)),
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
    inContainer,
    version: hubVersion,
    changed: () => ctx.hub.broadcast('machines', { changedAt: Date.now() }),
    // A machine gone from a project's list cuts its width to the machines left; one connected raises none (BTN-1571).
    poolCounted: () =>
      fitWidths(Object.keys(ctx.configStore.current.projects), {
        widthOf: (project) => ctx.configStore.current.settings[project]?.width ?? 1,
        capOf: (project) => network.machinesIn(project),
        save: (project, width) => ctx.configStore.saveWidth(project, width),
        label: (project) => projectLabel(ctx.configStore.current, project),
        log,
      }),
    projectSettings: (project) => ctx.configStore.current.settings[project],
    servers: (project) => ctx.packages.localStdio(project),
    briefed: (machine) => afterGreen.back(machine),
    peers: {
      remote: (machine) => remoteOf(() => machine),
      brief: (folders, settings) => briefOf(folders, settings, true),
      changed: () => {
        steerLimits()
        // The page shows each machine's accounts and its sign-in under way (`MachineNetwork.signIns`).
        ctx.hub.broadcastSoon('state', () => ctx.getState())
      },
      connected: (machine) => polls.connected(machine),
      mcp: (machine, request) => hubMcp.relay(machine, request),
      hook: (machine, request) => hubHooks.relay(machine, request),
      tally: (machine, rows) => machineTally.take(machine, rows),
      credentials: gitCredentialsOf,
      skills: (_machine, install) => ({ skills: ctx.packages.skillsOf(install) }),
      write: (machine, write) => hubMcp.write(machine, write),
    },
    takeOverOwn: async (project, owner) => {
      takeOvers.set(project, owner)
      await agree(true)
    },
    polled: (account) => polls.poller(account) !== undefined,
    differs: (account) => polls.differs(account),
    hubAccount: (key) => {
      const tie = remote.facts()?.identities?.[key]
      return tie === undefined ? undefined : { account: tie.account, email: tie.email }
    },
    hubLongToken: (key) => {
      const home = machine.homes.find(key)
      return home?.agent === CLAUDE ? (heldLongToken(home.dir) ?? undefined) : undefined
    },
    log,
  })

  const afterGreen = new PoolAfterGreen({
    own: () => own,
    pool: (project, machine) => network.afterGreenPool(project, machine),
    projectsOf: (machine) => network.projectsOf(machine),
    mark: (project, machine, commit) => network.markAfterGreen(project, machine, commit),
    // A machine on the link speaks the hub's protocol: another build runs its commands too (BTN-1609).
    ready: (machine) => network.connected(machine),
    port: (machine) => network.port(machine),
    green: (project) => ((ctx.configStore.current.settings[project]?.ci ?? DEFAULT_CI).guard ? ctx.dispatcher.state.ci[project]?.green : undefined),
    name: (machine) => network.names()[machine] ?? machine,
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
  const sessionMachine = (sessionId: string): string | undefined => {
    if (remote.page.sessions().some((view) => view.sessionId === sessionId)) return own
    const holder = network.holderOf(sessionId)
    if (holder !== undefined) return holder
    const launch = ctx.launches.findLast((entry) => entry.sessionId === sessionId)
    return launch === undefined ? undefined : assignments.machineOf(launch.project, launch.task)
  }
  const transcripts = sessionTranscripts({
    own: () => own,
    sessionMachine,
    ownReads: services.transcript,
    elsewhere: (machine) => (network.connected(machine) ? network.remote(machine)?.services().transcript : undefined),
    nameOf: async (machine) => (await network.record(machine))?.name ?? machine,
  })
  const port = machinePool({
    own: () => own,
    port: (machine) => (machine === own ? ownPort : network.port(machine)),
    machineOf: (project, task) => assignments.machineOf(project, task),
    projectOf: ctx.projectOf,
    sessionMachine,
    folderMachine: (folder) => (remote.page.sessions().some((view) => samePath(view.cwd, folder)) ? own : network.folderHolder(folder)),
  })
  const chain = chainMachines({
    own: () => own,
    parallel: () => ctx.configStore.current.parallel,
    peers: () => network.takers(),
    pool: (project) => network.poolOf(project),
    width: (project) => ctx.configStore.current.settings[project]?.width ?? 1,
    componentLanes: (project) => ctx.configStore.current.settings[project]?.componentLanes === true,
    machineOf: (project, task) => assignments.machineOf(project, task),
    revoked: (machine) => network.revoked(machine),
    connected: (machine) => network.connected(machine),
    // As `BranchControl.held`: the machine reads only its projects with git, so a project without one is never there.
    held: (project, machine) => {
      const current = machine === own ? undefined : network.remote(machine)?.facts()?.checkouts?.[project]?.branch
      return current !== undefined && current !== ctx.branchOf(project)
    },
    agentOf: (project, task) => ctx.runsOfProject(project)[task]?.provider ?? runSettings(ctx.configStore.current, project).provider,
    agents: (machine) => pageOf(machine)?.panel()?.accounts.map((entry) => entry.agent),
    lacks: (project, task, machine) => (machine === own ? ownPort : network.port(machine))?.launchBlock(project, task)?.code === 'machines.accountAbsent',
    pinned: (project, task) => ctx.runsOfProject(project)[task]?.machines,
    movedFrom: (project, task) => moves.from(project, task),
    bind: (project, task, machine) => assignments.assign(project, task, machine),
    switchOnLimit: () => ctx.configStore.current.switchOnLimit,
    hasLimit: (project, task, machine) => {
      const at = machine === own ? ownPort : network.port(machine)
      return at !== undefined && at.accountsRead() && at.limitsUnread(project, task) === undefined && at.limitReset(project, task) === null
        && (at.modelWeek?.(project, task) ?? null) === null
    },
    limitMoved: (project, task, from, to) => {
      const names = network.names()
      ctx.eventLog.add({ level: 'info', notice: notice('eventLog.limitMoved', { task, from: names[from] ?? from, to: names[to] ?? to }), place: { view: 'task', project, task } })
    },
  })
  const reassigner = new Reassigner({
    own: () => own,
    assignments,
    moves,
    connected: (machine) => network.connected(machine),
    names: () => network.names(),
    repoOf: (project) => ctx.configStore.current.projects[project],
    git: withCredentials(runGit, folderGitCredentials(ctx)),
    moved: (project, task) => ctx.dispatcher.moved(project, task),
    changed: () => ctx.hub.broadcastSoon('state', () => ctx.getState()),
    log,
  })

  return {
    hubCommit,
    hubBuild,
    updates,
    port,
    afterGreen,
    machines: chain,
    assignments,
    reassigner,
    records,
    page: remote.page,
    sessions: allSessions(() => [remote.page, ...network.pages()]),
    mirror: (machine) => (machine === own ? remote : network.remote(machine)),
    own: () => own,
    inPool: (machine, project) => hubMcp.inPool(machine, project),
    mergedElsewhere: (project, task) => {
      const machine = assignments.machineOf(project, task)
      const at = machine === undefined || machine === own ? undefined : network.port(machine)
      if (at === undefined) return undefined
      return network.connected(machine!) ? at.merged(project, task) : Promise.resolve([])
    },
    services,
    transcripts,
    network,
    polled: (account) => polls.poller(account) !== undefined,
    differs: (account) => polls.differs(account),
    start: async () => {
      // Before the own machine's replayed records: the messages kept before rows knew their machine are its own.
      await adoptMail(ctx.db, own)
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
      // never read from the hub's database by the machine. Its mailbox gets only its own messages.
      // The longest series a restart could cut: the idle ceiling and an hour's cache warmed past it.
      const warm = await readWarmPings(ctx.db, new Date(Date.now() - (MAX_KEEP_WARM_HOURS + 1) * 60 * 60_000))
      await services.records.restore({ launches: ctx.launches, windows: await loadSessionWindows(ctx.db), mail: await loadMail(ctx.db, own), warm })
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
