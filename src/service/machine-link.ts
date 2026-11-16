import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { chainOrder } from '../chain/order.js'
import type { LaunchEntry } from '../chain/dispatcher.js'
import { launchLine } from '../chain/log.js'
import { fileNote, keepHandoffNote, lastHandoffNote } from '../chain/handoff-notes.js'
import { saveSnapshot } from '../chain/snapshots.js'
import { CLAUDE } from '../claude/name.js'
import { AccountIdentities } from '../limits/identity.js'
import { AccountPolls, type AccountTie } from '../limits/polls.js'
import { listenOf } from '../config.js'
import { machinesPortOf } from '../link/address.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { hubIdentity } from '../link/identity.js'
import { MachineNetwork } from './machine-network.js'
import { HubEnd } from '../link/hub.js'
import { LOCAL_HEARTBEAT_MS, LocalTransport } from '../link/local.js'
import { DatabaseMachineStore, MACHINE_DIR } from '../link/machine-store.js'
import { MachineEnd } from '../link/machine.js'
import { bearerOf } from '../link/protocol.js'
import { Assignments, fillPool } from '../machine/assignments.js'
import { sameJson } from '../machine/facts.js'
import { ownMachine } from '../machine/own.js'
import type { PageReads } from '../machine/page.js'
import { MachineMoves } from '../machine/moves.js'
import type { MachinePort } from '../machine/port.js'
import { RemoteMachine } from '../machine/remote.js'
import { LAUNCH_EVENT, MachineRecords, saveMachineRecord } from '../machine/records.js'
import { HANDOFF_EVENT, LEFTOVER_EVENT, MachineRunner, TRANSCRIPT_EVENT } from '../machine/runner.js'
import { samePath } from '../paths.js'
import type { SessionMail } from '../sessions/mail.js'
import { loadMail } from '../sessions/mailbox.js'
import type { MachineServices } from '../machine/services.js'
import { wireMachineServices } from './machine-services.js'
import { BriefSender, hubBrief } from './hub-brief.js'
import type { MachineContext } from './machine-context.js'
import { loadSessionWindows } from '../storage/context-windows.js'
import type { ChainContext } from './chain.js'
import type { ServiceContext } from '../service.js'
import { KEPT_WRITE_EVENT, type KeptWrite } from '../taskmcp/machine.js'
import { HubMcp, machineTasks } from './hub-mcp.js'
import { steer, wireMachine } from './machine-chain.js'

export { MACHINE_DIR }
/** How long the start waits for the machine's first snapshot; past it the chain simply does not step until it comes. */
const FIRST_SNAPSHOT_MS = 30_000
/** How often the machine posts what changed when no step of the chain asked for it: the page's actions read the mirror too. */
const PUBLISH_EVERY_MS = 5_000

export interface LinkedMachine {
  /** The hub's side of the port: what the chain is given. */
  port: MachinePort
  assignments: Assignments
  records: MachineRecords
  /** What the page and the chat read of the machine's sessions and accounts: its mirror, never the machine's objects. */
  page: PageReads
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
export async function wireLinkedMachine(ctx: ChainContext & Pick<ServiceContext, 'runsOfProject' | 'demo' | 'machineDb'>, machine: MachineContext): Promise<LinkedMachine> {
  const log = (line: string): void => console.log(line)
  const { machineDb } = ctx
  const hubStore = new DatabaseHubStore(ctx.db)
  const machineStore = new DatabaseMachineStore(machineDb)
  let own = ''

  const assignments = await Assignments.open({
    db: ctx.db,
    writes: ctx.writes,
    order: (project) => {
      try {
        return chainOrder(ctx.tasksByProject.get(project) ?? [], ctx.dispatcher.state.orders[project])
      } catch {
        return []
      }
    },
  })

  let agreedFor = ''
  /** The machine serves the projects of its own installation, each in its folder; a project gone is served no longer. */
  const agree = async (): Promise<void> => {
    const { projects } = ctx.configStore.current
    const signature = JSON.stringify(projects)
    if (signature === agreedFor) return
    for (const { project, folder } of await machineStore.consents()) {
      const repo = projects[project]
      if (repo === undefined || !samePath(repo, folder)) await machineStore.withdraw(project, folder)
    }
    for (const [project, repo] of Object.entries(projects)) await machineStore.agree(project, repo)
    await fillPool(ctx.db, own, Object.keys(projects))
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

  const remote: RemoteMachine = new RemoteMachine({
    send: (machine, command) => hub.send(machine, command),
    machine: () => own,
    projectOf: ctx.projectOf,
    projectOfSession: (sessionId) => ctx.launches.findLast((entry) => entry.sessionId === sessionId)?.project,
    lastSession: (project, task) => ctx.launches.findLast((entry) => entry.project === project && entry.task === task)?.sessionId,
    brief: (project, task, retained) => ctx.briefed.prepare(task, project, retained),
    note: (project, task) => lastHandoffNote(ctx.db, project, task),
    saveSnapshot: async (snapshot) => {
      await saveSnapshot(ctx.db, snapshot)
      const note = fileNote(snapshot, ctx.projectOf(snapshot.task), own)
      if (note !== undefined) await keepHandoffNote(ctx.db, note)
    },
    record: async (sent) => {
      // Where the task is read from is the hub's to know (BTN-66): the machine's journal entry has no source.
      const event = sent.type === LAUNCH_EVENT ? { ...sent, payload: ctx.withSource(sent.payload as LaunchEntry) } : sent
      if (!await saveMachineRecord(ctx.db, own, event)) return
      if (event.type === LAUNCH_EVENT) {
        const entry = event.payload as LaunchEntry
        ctx.launches.push(entry)
        ctx.eventLog.launched(entry)
        log(launchLine(entry))
      }
      ctx.hub.broadcastSoon('state', () => ctx.getState())
    },
    assigned: (project, task) => assignments.assign(project, task, own),
    released: (project, task) => assignments.release(project, task),
    held: (named, live) => assignments.reconcile(own, named, live),
    catchUp,
    stopped: (session) => {
      const launch = ctx.launches.findLast((entry) => entry.sessionId === session.sessionId)
      if (launch !== undefined) ctx.eventLog.stopped(launch.project, launch.task)
    },
    leftover: (project, task, notice) => ctx.dispatcher.leftover(project, task, notice),
    transcript: (sessionId) => ctx.hub.signal('transcript', { sessionId }),
    changed: () => {
      steerLimits()
      ctx.hub.broadcastSoon('state', () => ctx.getState())
    },
    log,
  })
  const polls = new AccountPolls({ hub: () => own, log })
  /** One poller per account and the newest limits for the others (`docs/machines.md`, "Account limits"). */
  const steerLimits = (): void => {
    const facts = remote.facts()
    if (facts === undefined) return
    const machines = [{ machine: own, online: hub.connected(own), identities: facts.identities ?? {}, limits: facts.limits }]
    for (const [machine, plan] of polls.plan(machines)) {
      remote.tellLimits(plan).catch((error: unknown) => {
        polls.connected(machine)
        log(`limits: the plan for machine ${machine} was not taken: ${messageOf(error)}`)
      })
    }
  }
  const hubMcp = new HubMcp({ db: ctx.db, origin: () => ctx.packages.hubOrigin, projects: () => Object.keys(ctx.configStore.current.projects), log })
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
      event: (machine, event) => (event.type === KEPT_WRITE_EVENT ? hubMcp.write(machine, event.payload as KeptWrite) : handlers.event(machine, event)),
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
    port: machinesPortOf(process.env),
    repoOf: (project) => ctx.configStore.current.projects[project],
    allowedHosts: () => ctx.configStore.current.allowedHosts,
    serviceHost: listenOf(process.env).host,
    changed: () => ctx.hub.broadcast('machines', { changedAt: Date.now() }),
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
  const briefs = new BriefSender(
    () => hubBrief({
      config: () => ctx.configStore.current,
      // The own machine serves every project of its installation, in its folder (`agree`).
      folders: () => ctx.configStore.current.projects,
      runsOf: ctx.runsOfProject,
      tasksOf: (project) => (ctx.tasksByProject.get(project) ?? []).map((task) => task.id),
      state: () => ctx.dispatcher.state,
      demoOwns: (project) => ctx.demo.owns(project),
      reports: ctx.checkReports,
    }),
    (brief) => remote.tellBrief(brief),
  )

  const local = wireMachine(machine, async (snapshot) => void (await end.emit(HANDOFF_EVENT, snapshot)))
  /** Kept for one computation of the facts, which asks per project: `projectOf` scans every project's tasks. */
  let pass: Map<string, string[]> | undefined
  const passOf = (): Map<string, string[]> => {
    if (pass !== undefined) return pass
    const running = new Map<string, string[]>()
    for (const task of machine.monitor.tasks()) {
      const project = machine.projectOf(task)
      if (project !== undefined) running.set(project, [...(running.get(project) ?? []), task])
    }
    return running
  }
  const moves = new MachineMoves({
    local,
    emit: (type, payload) => end.emit(type, payload),
    // The launch journal is the hub's record that the machine's outbox carries (`docs/machines.md`, "Journal").
    journal: (entry) => machine.writes.add(`the launch of ${entry.task}`, records.launch(entry)),
    now: () => new Date(),
    log,
  })
  const identities = new AccountIdentities()
  const ownRun = (project: string, task: string): boolean => !sameJson(machine.choiceFor(project, task), machine.choiceFor(project))
  const runner: MachineRunner = new MachineRunner({
    local,
    emit: (type, payload) => end.emit(type, payload),
    boot: randomUUID(),
    projects: () => Object.keys(machine.configStore.current.projects),
    tasks: () => {
      const sessions = new Map<string, Set<string>>()
      const of = (task: string): Set<string> => sessions.get(task) ?? sessions.set(task, new Set()).get(task)!
      for (const task of machine.monitor.tasks()) of(task)
      for (const agent of machine.agents) if (agent.name !== undefined) of(agent.name)
      for (const view of machine.sessions) of(view.task).add(view.sessionId)
      return [...sessions].map(([task, ids]) => ({ task, sessions: [...ids] }))
    },
    runs: (project) => {
      const listed = machine.brief.tasksOf(project)
      return [...new Set([...listed, ...(passOf().get(project) ?? [])])].filter((task) => ownRun(project, task))
    },
    reported: (project) => machine.brief.reported(project),
    model: (project, task) => machine.choiceFor(project, task).model,
    accounts: () => machine.homes.all().map((home) => home.key),
    limitsOf: (account) => machine.limits.limits(account),
    ledger: () => machine.ledger.accounts,
    sessions: () => machine.sessions,
    mailbox: () => Object.fromEntries(machine.sessions.flatMap((view): [string, SessionMail][] => {
      const mail = machine.mailbox.of(view.sessionId)
      const steers = machine.agents.some((agent) => agent.sessionId === view.sessionId && agent.steers === true)
      const listens = steers || machine.mailbox.listens(view.sessionId)
      return listens || mail.length > 0 ? [[view.sessionId, { listens, steers, mail }]] : []
    })),
    // Read with the CLI copies the page shows, so it never sees a CLI as found there and missing here (BTN-639).
    panel: () => ({ ...machine.account.view, missing: machine.account.missingNow() }),
    usageOf: (account) => machine.limits.usage(account),
    owners: () => {
      const owners: Record<string, string> = {}
      for (const { sessionId } of machine.journal) {
        const key = machine.owners.of(sessionId)
        if (key !== undefined) owners[sessionId] = key
      }
      for (const agent of machine.agents) {
        const key = agent.account ?? machine.owners.of(agent.sessionId)
        if (key !== undefined) owners[agent.sessionId] = key
      }
      return owners
    },
    compactions: () => machine.monitor.compactionCounts(),
    identities: () => {
      const ties: Record<string, AccountTie> = {}
      for (const home of machine.homes.all()) {
        if (home.agent !== CLAUDE) continue
        const signed = identities.of(machine.homes.configFile(home))
        if (signed === undefined) continue
        ties[home.key] = { ...signed, polls: machine.limits.pollable(home.key), ...(machine.limits.skipped(home.key) && { skipped: true as const }) }
      }
      return ties
    },
    limitsPlan: (plan) => machine.limits.plan(plan),
    brief: (brief) => {
      const first = !machine.brief.received
      machine.brief.take(brief)
      // The projects without git are known from the first brief on: what their folders have become is read then.
      if (first) void machine.gitFound.checkAll().catch((error: unknown) => log(`git: the projects without git were not read: ${messageOf(error)}`))
    },
    works: () => machine.works.view(),
    gitFound: () => machine.gitFound.view(),
    moves,
    services: wireMachineServices(machine, {
      steer: (task, session, prompt) => steer(machine, task, session, prompt),
      restore: async ({ launches, windows, mail }) => {
        records.restore(launches)
        machine.mailbox.restore(mail)
        machine.monitor.restoreWindows(windows)
      },
    }),
    scope: (body) => machine.account.batch(() => machine.choiceFor.pass(() => {
      pass = passOf()
      try {
        return body()
      } finally {
        pass = undefined
      }
    })),
    log,
  })

  let online = (): void => {}
  const first = new Promise<void>((resolve) => (online = resolve))
  const end: MachineEnd = new MachineEnd({
    transport: new LocalTransport(hub, bearerOf(token)),
    store: machineStore,
    concurrent: true,
    snapshot: () => runner.snapshot(),
    command: (command) => runner.command(command),
    changed: () => {
      if (end.status().state === 'online') online()
    },
    log,
  })
  let publishing: ReturnType<typeof setInterval> | undefined
  const records = new MachineRecords((type, payload) => end.emit(type, payload), machine.journal)
  machine.tell.connect({
    leftover: (project, task, notice) => void end.emit(LEFTOVER_EVENT, { project, task, notice }).catch((error: unknown) => log(`machine: what the cleanup left on ${task} was not told: ${messageOf(error)}`)),
    transcript: (sessionId) => void end.emit(TRANSCRIPT_EVENT, { sessionId }).catch(() => {}),
    changed: () => void runner.publish().catch(() => {}),
  })
  const services = remote.services()
  machine.mailbox.persistWith(async (change) => {
    await records.mailbox(change)
    await runner.publish()
  })

  return {
    port: remote.port(),
    assignments,
    records,
    page: remote.page,
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
      machine.packages.throughHub({ servers: () => machine.packages.hubServers(), relay: (request) => end.mcp(request), tasks: machineTasks(machine, end) })
      await end.flushed()
      // The machine's journal, mailbox and windows are the hub's records, replayed ones included: handed over the link,
      // never read from the hub's database by the machine.
      await services.records.restore({ launches: ctx.launches, windows: await loadSessionWindows(ctx.db), mail: await loadMail(ctx.db) })
      publishing = setInterval(() => void catchUp(), PUBLISH_EVERY_MS)
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
